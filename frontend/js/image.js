/**
 * image.js — client-side image compression + upload routing.
 *
 * Architecture req #2:
 *   - Downscale longest edge to IMAGE_MAX_DIM (1200px) before upload.
 *   - Re-encode as JPEG at IMAGE_QUALITY.
 *   - Files >2MB use the chunked upload protocol; otherwise a single POST.
 */
(function () {
  'use strict';
  var CFG = window.UBC_CONFIG;

  /** Read a File/Blob into an HTMLImageElement. */
  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Cannot decode image')); };
      img.src = url;
    });
  }

  /**
   * Compress an image File to a JPEG Blob with longest edge <= maxDim.
   * Non-image files are returned unchanged.
   * @return {Promise<{blob:Blob, name:string, mime:string}>}
   */
  function compress(file, maxDim, quality) {
    maxDim = maxDim || CFG.IMAGE_MAX_DIM;
    quality = quality || CFG.IMAGE_QUALITY;

    if (!file.type || file.type.indexOf('image/') !== 0) {
      return Promise.resolve({ blob: file, name: file.name, mime: file.type || 'application/octet-stream' });
    }

    return loadImage(file).then(function (img) {
      var w = img.naturalWidth, h = img.naturalHeight;
      var scale = Math.min(1, maxDim / Math.max(w, h));
      var tw = Math.round(w * scale), th = Math.round(h * scale);

      var canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, tw, th);

      return new Promise(function (resolve) {
        var baseName = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
        if (canvas.toBlob) {
          canvas.toBlob(function (blob) {
            resolve({ blob: blob, name: baseName, mime: 'image/jpeg' });
          }, 'image/jpeg', quality);
        } else {
          // Safari/old fallback via dataURL
          var dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve({ blob: dataURLtoBlob(dataUrl), name: baseName, mime: 'image/jpeg' });
        }
      });
    });
  }

  function dataURLtoBlob(dataUrl) {
    var parts = dataUrl.split(',');
    var mime = parts[0].match(/:(.*?);/)[1];
    var bin = atob(parts[1]);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  /** Blob -> base64 string (no data: prefix). */
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        var res = reader.result;
        var comma = res.indexOf(',');
        resolve(comma >= 0 ? res.slice(comma + 1) : res);
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Upload an already-compressed {blob,name,mime} to a Drive folder, choosing
   * single-shot vs chunked based on size. Returns the server file result.
   * Requires online connectivity (used during sync / direct upload).
   */
  function uploadCompressed(folderId, compressed) {
    return blobToBase64(compressed.blob).then(function (b64) {
      var approxBytes = compressed.blob.size;
      if (approxBytes <= CFG.CHUNK_THRESHOLD_BYTES) {
        return window.UBC_API.uploadSmall(folderId, compressed.name, compressed.mime, b64);
      }
      // Chunked path
      var chunkSize = CFG.CHUNK_SIZE_B64;
      var total = Math.ceil(b64.length / chunkSize);
      return window.UBC_API.uploadBegin({
        fileName: compressed.name, mimeType: compressed.mime,
        totalChunks: total, folderId: folderId
      }).then(function (begin) {
        var uploadId = begin.uploadId;
        var chain = Promise.resolve();
        for (var i = 0; i < total; i++) {
          (function (idx) {
            chain = chain.then(function () {
              return window.UBC_API.uploadChunk(uploadId, idx, b64.slice(idx * chunkSize, (idx + 1) * chunkSize));
            });
          })(i);
        }
        return chain.then(function () { return window.UBC_API.uploadFinish(uploadId); });
      });
    });
  }

  /** Full helper: compress a File then upload to folder. */
  function compressAndUpload(folderId, file) {
    return compress(file).then(function (c) { return uploadCompressed(folderId, c); });
  }

  window.UBC_IMG = {
    compress: compress,
    blobToBase64: blobToBase64,
    uploadCompressed: uploadCompressed,
    compressAndUpload: compressAndUpload
  };
})();
