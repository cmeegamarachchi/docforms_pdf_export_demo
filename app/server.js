const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const normalizeKey = (k) => {
  // Accept either plain names (CUST_NAME) or tag style (<tag_CUST_NAME_tag>)
  const tag = /^<tag_([A-Za-z0-9_]+)_tag>$/;
  const m = tag.exec(k);
  return m ? m[1] : k;
};

async function fillAcroform(templatePath, dataPath, outPath) {
  const templateBytes = fs.readFileSync(templatePath);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

  const pdfDoc = await PDFDocument.load(templateBytes);

  // Embed a font so pdf-lib can draw new appearances for fields
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const form = pdfDoc.getForm();

  // Helper to set a field by name, with smart handling per field type
  const setField = (fieldName, value) => {
    const field = form.getFieldMaybe(fieldName);
    if (!field) return false;

    const type = field.constructor.name;

    if (type === 'PDFTextField') {
      field.setText(value == null ? '' : String(value));
    } else if (type === 'PDFDropdown') {
      // If the option isn't present, many PDFs still accept it; otherwise add it first:
      try {
        field.select(String(value));
      } catch {
        // Add option then select
        field.addOptions(String(value));
        field.select(String(value));
      }
    } else if (type === 'PDFRadioGroup') {
      // Must match one of the radio "options" values
      field.select(String(value));
    } else if (type === 'PDFCheckBox') {
      // Accept booleans or strings like "Yes"/"On"/"Off"
      const v = typeof value === 'string' ? value.toLowerCase() : value;
      const checked =
        v === true || v === 'yes' || v === 'on' || v === 'checked' || v === 'true' || v === '1';
      if (checked) field.check();
      else field.uncheck();
    } else {
      // Other field types (signatures, etc.) can be ignored or logged
      // console.warn(`Unsupported field type for ${fieldName}: ${type}`);
      return false;
    }

    return true;
  };

  // Update appearances with our embedded font (important for reliable rendering)
  form.updateFieldAppearances(font);

  // Apply all provided values
  let appliedCount = 0;
  for (const rawKey of Object.keys(data)) {
    const key = normalizeKey(rawKey);
    const ok = setField(key, data[rawKey]);
    if (ok) appliedCount++;
  }

  // Optional: flatten form so fields become plain text and are no longer editable
  form.flatten();

  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, outBytes);
  console.log(`Filled ${appliedCount} fields. PDF written to: ${outPath}`);
}

(async () => {
  const [,, inPdf, inJson, outPdf] = process.argv;
  if (!inPdf || !inJson || !outPdf) {
    console.error('Usage: node server.js <template.pdf> <data.json> <output.pdf>');
    process.exit(1);
  }
  await fillAcroform(path.resolve(inPdf), path.resolve(inJson), path.resolve(outPdf));
})();
