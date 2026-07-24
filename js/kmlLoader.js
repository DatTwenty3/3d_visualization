/**
 * KML / KMZ centerline (tim tuyến) loader
 * Extracts the longest LineString and returns WGS84 [lat, lng] vertices.
 */

function parseKmlCoordinatesText(coordText) {
  if (!coordText) return [];
  const pts = [];
  const tokens = coordText.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const parts = tokens[i].split(',');
    if (parts.length < 2) continue;
    const lng = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    pts.push([lat, lng]);
  }
  return pts;
}

function lineLengthApprox(latLngs) {
  let len = 0;
  for (let i = 1; i < latLngs.length; i++) {
    const dLat = (latLngs[i][0] - latLngs[i - 1][0]) * 111320;
    const midLat = ((latLngs[i][0] + latLngs[i - 1][0]) / 2) * Math.PI / 180;
    const dLng = (latLngs[i][1] - latLngs[i - 1][1]) * 111320 * Math.cos(midLat);
    len += Math.hypot(dLat, dLng);
  }
  return len;
}

/**
 * Parse KML XML text → array of [lat, lng] (longest LineString).
 */
function parseKmlText(text) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('File KML không hợp lệ (XML lỗi).');
  }

  const lineNodes = doc.getElementsByTagName('LineString');
  let best = [];
  let bestLen = -1;

  for (let i = 0; i < lineNodes.length; i++) {
    const coordEls = lineNodes[i].getElementsByTagName('coordinates');
    if (!coordEls.length) continue;
    const pts = parseKmlCoordinatesText(coordEls[0].textContent);
    if (pts.length < 2) continue;
    const len = lineLengthApprox(pts);
    if (len > bestLen) {
      bestLen = len;
      best = pts;
    }
  }

  if (best.length < 2) {
    throw new Error('Không tìm thấy LineString (tim tuyến) trong file KML/KMZ.');
  }
  return best;
}

/**
 * Load .kml or .kmz File → Promise<[lat, lng][]>
 */
async function loadKmlKmz(file) {
  if (!file) throw new Error('Chưa chọn file.');
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.kmz')) {
    if (typeof JSZip === 'undefined') {
      throw new Error('Thư viện JSZip chưa được tải (cần để đọc KMZ).');
    }
    const zip = await JSZip.loadAsync(file);
    const kmlEntry = Object.keys(zip.files).find((p) =>
      p.toLowerCase().endsWith('.kml') && !zip.files[p].dir
    );
    if (!kmlEntry) {
      throw new Error('File KMZ không chứa file .kml nào.');
    }
    const text = await zip.files[kmlEntry].async('string');
    return parseKmlText(text);
  }

  if (name.endsWith('.kml') || name.endsWith('.xml')) {
    const text = await file.text();
    return parseKmlText(text);
  }

  // Fallback: try as text KML
  const text = await file.text();
  return parseKmlText(text);
}

window.parseKmlText = parseKmlText;
window.loadKmlKmz = loadKmlKmz;
