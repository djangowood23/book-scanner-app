'use strict';

// --- Global Variables ---
let sessionBooks = []; // Array to hold book objects added in this session
let lastBackendResponseData = null; // To store backend response (mainly for GCS URLs)
let imageBase64Data = { // Store base64 data from file uploads
    image_data_1: null,
    image_data_2: null
};

// --- Get references to HTML elements ---
// Removed: video, canvas, captureButton, snapshotImg, context
const imageUploadInput = document.getElementById('imageUpload');
const filePreviewDiv = document.getElementById('filePreview');
const pastedDataTextArea = document.getElementById('pastedData');
const populateButton = document.getElementById('populateFromTextButton');

// Form Elements & Buttons
const addBookButton = document.getElementById('addBookButton');
const exportCsvButton = document.getElementById('exportCsvButton');
const bookCountSpan = document.getElementById('bookCount');
const booksUl = document.getElementById('booksUl');
// Input field references
const skuInput = document.getElementById('sku');
const titleInput = document.getElementById('title');
const authorInput = document.getElementById('author');
const isbnInput = document.getElementById('isbn');
const conditionSelect = document.getElementById('condition');
const conditionTextInput = document.getElementById('condition_text');
const priceInput = document.getElementById('price');
const qtyInput = document.getElementById('qty');
const notesInput = document.getElementById('notes');
const publisherInput = document.getElementById('publisher');
const releaseDateInput = document.getElementById('release_date');
const mediaInput = document.getElementById('media');
const locationInput = document.getElementById('location'); // Location input
const costInput = document.getElementById('cost');
const sourceInput = document.getElementById('source');
const imageUrlInput = document.getElementById('image_url'); // Will store GCS URL
const signedFlagCheckbox = document.getElementById('signed_flag');
const editionInput = document.getElementById('edition');
const languageInput = document.getElementById('language');
const volumeInput = document.getElementById('volume'); // Added volume field ref
// Helper button references
const btn1stEd = document.getElementById('btn1stEd');
const btnMediaPB = document.getElementById('btnMediaPB');
const btnMediaHC = document.getElementById('btnMediaHC');
const btnMediaCD = document.getElementById('btnMediaCD');
const btnMediaDVD = document.getElementById('btnMediaDVD');


// --- SKU Generation Logic ---
// (Keep existing SKU functions: parseSkuPattern, generateNextSku, initializeSku)
function parseSkuPattern(startSku) { const match = startSku.match(/^(.+?)([0-9]+)$/); if (match && match[1] && match[2]) { const prefix = match[1]; const numberStr = match[2]; const number = parseInt(numberStr, 10); const padding = numberStr.length; sessionStorage.setItem('skuPrefix', prefix); sessionStorage.setItem('skuPadding', padding.toString()); sessionStorage.setItem('lastSkuNumber', (number - 1).toString()); console.log(`SKU Pattern Set: Prefix='${prefix}', StartNumber=${number}, Padding=${padding}`); return true; } else { alert("Invalid SKU pattern..."); return false; } }
function generateNextSku() { const prefix = sessionStorage.getItem('skuPrefix'); const paddingStr = sessionStorage.getItem('skuPadding'); const lastNumberStr = sessionStorage.getItem('lastSkuNumber'); if (prefix === null || paddingStr === null || lastNumberStr === null) { console.error("SKU pattern not initialized."); initializeSku(); const updatedPrefix = sessionStorage.getItem('skuPrefix'); if (updatedPrefix === null) return null; return null; } const padding = parseInt(paddingStr, 10); const lastNumber = parseInt(lastNumberStr, 10); const nextNumber = lastNumber + 1; const nextNumberStr = String(nextNumber).padStart(padding, '0'); sessionStorage.setItem('lastSkuNumber', nextNumber.toString()); const nextSku = prefix + nextNumberStr; console.log(`Generated next SKU: ${nextSku}`); return nextSku; }
function initializeSku() { if (sessionStorage.getItem('skuPrefix') === null) { const startSku = prompt("Enter starting SKU pattern (e.g., PREFIX-001 or ITEM100):"); if (startSku) { if (!parseSkuPattern(startSku)) { sessionStorage.removeItem('skuPrefix'); sessionStorage.removeItem('skuPadding'); sessionStorage.removeItem('lastSkuNumber'); } } else { alert("SKU generation skipped..."); } } else { console.log("SKU pattern already initialized..."); } }
// --- End SKU Generation Logic ---

// --- Camera Logic Removed ---

// --- File Input Handling ---
if (imageUploadInput) {
    imageUploadInput.addEventListener('change', (event) => {
        const files = event.target.files;
        filePreviewDiv.innerHTML = ''; // Clear previous preview
        imageBase64Data.image_data_1 = null; // Reset stored data
        imageBase64Data.image_data_2 = null;

        if (!files || files.length === 0) {
            filePreviewDiv.textContent = 'No files selected.';
            return;
        }
        console.log(`Selected ${files.length} file(s).`);
        const maxFiles = Math.min(files.length, 2);
        let filesProcessed = 0;
        for (let i = 0; i < maxFiles; i++) {
            const file = files[i];
            const reader = new FileReader();
            reader.onload = (e) => {
                if (i === 0) {
                    imageBase64Data.image_data_1 = e.target.result;
                    console.log("Image 1 loaded as base64.");
                    filePreviewDiv.innerHTML += `<div>File 1: ${file.name} (Cover/Primary)</div>`;
                } else if (i === 1) {
                    imageBase64Data.image_data_2 = e.target.result;
                    console.log("Image 2 loaded as base64.");
                     filePreviewDiv.innerHTML += `<div>File 2: ${file.name} (Details/Barcode)</div>`;
                }
                filesProcessed++;
                if (filesProcessed === maxFiles) console.log("Finished processing selected files.");
            };
            reader.onerror = (e) => {
                console.error("Error reading file:", file.name, e);
                filePreviewDiv.innerHTML += `<div style="color: red;">Error reading ${file.name}</div>`;
                 filesProcessed++;
                 if (filesProcessed === maxFiles) console.log("Finished processing selected files (with errors).");
            };
            reader.readAsDataURL(file); // Read file as base64 Data URL
        }
         if (files.length > 2) {
             filePreviewDiv.innerHTML += `<div style="color: orange;">Note: Only the first two selected images will be processed.</div>`;
         }
    });
} else { console.error("Image Upload Input not found."); }

// --- Paste Data & Populate Form Logic ---
if (populateButton) {
    populateButton.addEventListener('click', () => {
        console.log("Populate From Text button clicked.");
        const pastedText = pastedDataTextArea.value.trim();
        if (!pastedText) { alert("Please paste data from BVS GPT into the text area first."); return; }

        // Expected header order from BVS GPT (9 fields)
        // title,author,publisher,release_date,language,edition,isbn,volume,avg_price
        const expectedHeaders = ['title', 'author', 'publisher', 'release_date', 'language', 'edition', 'isbn', 'volume', 'price'];
        const numExpectedFields = expectedHeaders.length;

        try {
            console.log("Parsing pasted text:", pastedText);
            const csvLine = pastedText.replace(/^```csv\s*|\s*```$/g, '').trim();
            // Basic CSV parsing respecting quotes
            const values = []; let currentVal = ''; let inQuotes = false;
            for (let i = 0; i < csvLine.length; i++) {
                const char = csvLine[i];
                if (char === '"' && (i === 0 || csvLine[i-1] !== '\\')) { inQuotes = !inQuotes; }
                else if (char === ',' && !inQuotes) { values.push(currentVal.trim()); currentVal = ''; }
                else { currentVal += char; }
            }
            values.push(currentVal.trim());
            const cleanedValues = values.map(v => v.replace(/^"|"$/g, '')); // Remove surrounding quotes
            console.log("Parsed values:", cleanedValues);

            if (cleanedValues.length !== numExpectedFields) { throw new Error(`Expected ${numExpectedFields} fields, found ${cleanedValues.length}. Check pasted data.`); }

            // Populate form fields
            titleInput.value = cleanedValues[0] || ''; authorInput.value = cleanedValues[1] || '';
            publisherInput.value = cleanedValues[2] || ''; releaseDateInput.value = cleanedValues[3] || '';
            languageInput.value = cleanedValues[4] || 'English'; editionInput.value = cleanedValues[5] || '';
            isbnInput.value = cleanedValues[6] || ''; volumeInput.value = cleanedValues[7] || '';
            priceInput.value = cleanedValues[8] || '50'; // Use avg_price from BVS

            // Reset other fields
            conditionSelect.value = '2'; conditionTextInput.value = ''; qtyInput.value = '1';
            notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK"; mediaInput.value = '';
            const lastLocation = sessionStorage.getItem('lastLocation'); locationInput.value = lastLocation || '';
            costInput.value = ''; sourceInput.value = ''; signedFlagCheckbox.checked = false; imageUrlInput.value = '';

            console.log("Form fields populated from pasted data.");
            alert("Form populated! Please upload the corresponding image(s) now if you haven't already.");

        } catch (error) { console.error("Error parsing pasted data:", error); alert(`Error parsing pasted data: ${error.message}. Please ensure data is a single CSV line with ${numExpectedFields} fields, correctly quoted.`); }
    });
} else { console.error("Populate From Text Button not found."); }


// --- Function to update the displayed list of books ---
function renderSessionBooks() { if (!booksUl || !bookCountSpan) { console.error("Book list UL/Span not found."); return; } booksUl.innerHTML = ''; bookCountSpan.innerText = sessionBooks.length; if (sessionBooks.length === 0) { booksUl.innerHTML = '<li>No books added yet.</li>'; return; } sessionBooks.forEach((book, index) => { const listItem = document.createElement('li'); listItem.textContent = `[${index + 1}] ${book.sku}: ${book.title || 'N/A'} by ${book.author || 'N/A'} - Price: ${book.price || 'N/A'}`; booksUl.appendChild(listItem); }); }

// --- Add Book Button Logic (Hybrid V3) ---
if (addBookButton) {
    addBookButton.addEventListener('click', () => {
        console.log("Add Book button clicked.");
        // Generate SKU just before adding
        const nextSku = generateNextSku();
        if (!nextSku) {
            alert("Could not generate SKU. Please ensure SKU pattern is initialized.");
            return; // Stop if SKU generation failed
        }
        skuInput.value = nextSku; // Populate SKU field now

        if (!imageBase64Data.image_data_1) { alert("Please upload the primary book image first."); return; }

        // Read values from form (SKU already set)
        const sku = skuInput.value.trim(); // Read the generated SKU
        const title = titleInput.value.trim(); const author = authorInput.value.trim();
        const isbn = isbnInput.value.trim(); const condition = conditionSelect.value; const condText = conditionTextInput.value.trim();
        const price = priceInput.value.trim(); const qty = qtyInput.value; const notes = notesInput.value.trim();
        const publisher = publisherInput.value.trim(); const releaseDate = releaseDateInput.value.trim(); const media = mediaInput.value.trim();
        const location = locationInput.value.trim(); const cost = costInput.value.trim(); const source = sourceInput.value.trim();
        const isSigned = signedFlagCheckbox.checked; const edition = editionInput.value.trim(); const language = languageInput.value.trim();
        const volume = volumeInput.value.trim();

        // Validation
        if (!sku) { alert("SKU is missing."); return; } // Should not happen now
        if (!price) { alert("Price required."); return; }
        const qtyInt = parseInt(qty, 10); if (isNaN(qtyInt) || qtyInt < 1) { alert("Qty must be >= 1."); return; }
        if (!title && !isbn) { alert("Title or ISBN required."); return; }

        // Prepare payload for backend (only image data needed for upload)
        const payload = {
            image_data_1: imageBase64Data.image_data_1,
            image_data_2: imageBase64Data.image_data_2 // Send second image if loaded
        };

        // Send Image Data to Backend for GCS Upload
        console.log("Sending image data to backend for GCS upload...");
        const backendUrl = 'https://us-central1-aob-scanner.cloudfunctions.net/book-scanner-process-image'; // Simplified backend endpoint
        fetch(backendUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        .then(response => { if (!response.ok) { return response.json().then(errData => { throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Unknown backend error'}`); }).catch(() => { throw new Error(`HTTP error! status: ${response.status}`); }); } return response.json(); })
        .then(uploadData => {
            console.log("Backend response (GCS URLs):", uploadData);
            if (uploadData && uploadData.image_url) { // Check if primary URL exists
                const gcsImageUrl1 = uploadData.image_url;
                const gcsImageUrl2 = uploadData.image_url_2; // Get URL for image 2 if returned

                // Create book data object using form data + GCS URLs
                const bookData = {
                    sku: sku, location: location, cost: cost ? parseFloat(cost) : null, source: source,
                    isbn: isbn, title: title, author: author, publisher: publisher, release_date: releaseDate,
                    image: gcsImageUrl1, image_2: gcsImageUrl2 || "", media: media, price: price,
                    condition: parseInt(condition, 10), notes: notes, qty: qtyInt, cond_text: condText,
                    edition: edition, signature: isSigned ? "Signed" : "", language: language, volume: volume
                };

                sessionBooks.push(bookData);
                console.log("Book added:", bookData); console.log("Session Array:", sessionBooks);

                // Save location for next time
                if (location) { sessionStorage.setItem('lastLocation', location); console.log(`Saved last location: ${location}`); }

                renderSessionBooks(); // Update visual list
                alert(`Book '${bookData.title || bookData.sku}' added! (${sessionBooks.length} total)`);

                // --- Clear/Reset Form for Next Entry ---
                console.log("Clearing form fields after adding book...");
                pastedDataTextArea.value = ''; // Clear pasted data
                imageUploadInput.value = ''; // Clear file input selection
                filePreviewDiv.innerHTML = ''; // Clear file preview
                imageBase64Data.image_data_1 = null; // Clear stored image data
                imageBase64Data.image_data_2 = null;
                lastBackendResponseData = null; // Clear stored response

                // Clear specific fields
                skuInput.value = ''; // Clear SKU for next auto-generation
                titleInput.value = ''; authorInput.value = ''; isbnInput.value = '';
                publisherInput.value = ''; releaseDateInput.value = ''; editionInput.value = ''; volumeInput.value = '';
                conditionTextInput.value = ''; mediaInput.value = ''; costInput.value = ''; sourceInput.value = '';
                imageUrlInput.value = ''; signedFlagCheckbox.checked = false;
                // Reset fields to defaults
                conditionSelect.value = '2'; priceInput.value = '50';
                notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK";
                qtyInput.value = '1'; languageInput.value = 'English';
                const lastLocation = sessionStorage.getItem('lastLocation'); // Keep sticky location
                locationInput.value = lastLocation || '';
                console.log("Form cleared/reset for next entry.");
                // --- End Form Clear/Reset ---

            } else {
                console.error("Backend did not return expected image URL(s).", uploadData);
                alert("Error: Failed to get image URL from backend after upload. Book not added.");
            }
        })
        .catch(error => {
             console.error('Error during image upload or processing:', error);
             alert(`Error adding book: ${error.message}. Check console.`);
        });
    });
} else { console.error("Add Book button not found."); }
// --- End Add Book Button Logic ---


// --- Helper Button Logic ---
function setInputValue(elementId, value) { const inputElement = document.getElementById(elementId); if (inputElement) { inputElement.value = value; } else { console.error(`Element ID ${elementId} not found.`); } }
if (btn1stEd) { btn1stEd.addEventListener('click', () => setInputValue('edition', 'First Edition')); } else { console.warn("btn1stEd not found"); }
if (btnMediaPB) { btnMediaPB.addEventListener('click', () => setInputValue('media', 'Paperback')); } else { console.warn("btnMediaPB not found"); }
if (btnMediaHC) { btnMediaHC.addEventListener('click', () => setInputValue('media', 'Hardcover')); } else { console.warn("btnMediaHC not found"); }
if (btnMediaCD) { btnMediaCD.addEventListener('click', () => setInputValue('media', 'Audio CD')); } else { console.warn("btnMediaCD not found"); }
if (btnMediaDVD) { btnMediaDVD.addEventListener('click', () => setInputValue('media', 'DVD')); } else { console.warn("btnMediaDVD not found"); }
// --- End Helper Button Logic ---

// --- CSV Export Logic ---
function escapeCsvCell(value) { if (value == null) { return ''; } const stringValue = String(value); if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) { return `"${stringValue.replace(/"/g, '""')}"`; } return stringValue; }
function exportBooksToCsv() {
    if (sessionBooks.length === 0) { alert("No books added..."); return; }
    console.log("Generating CSV...");
    // Updated headers for V3 Hybrid (includes volume, image_2)
    const headers = [
        'sku', 'location', 'cost', 'source', 'isbn', 'title', 'author',
        'publisher', 'release_date', 'image', 'image_2', 'media', 'price',
        'condition', 'notes', 'qty', 'cond_text', 'edition', 'signature',
        'language', 'volume' // Added volume
    ];
    const headerRow = headers.map(escapeCsvCell).join(',');
    const dataRows = sessionBooks.map(book => { return headers.map(header => escapeCsvCell(book[header])).join(','); });
    const csvContent = [headerRow, ...dataRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    // *** FILENAME GENERATION (Handles articles) ***
    let filename = 'aob_export.csv'; // Default filename
    if (sessionBooks.length > 0) {
        try {
            const firstBookTitle = sessionBooks[0].title || ''; // Handle null title
            let descriptiveWord = 'Export'; // Default fallback
            const words = firstBookTitle.trim().split(/\s+/); // Split by whitespace

            if (words.length > 0 && words[0] !== '') { // Check if title is not empty/just spaces
                const firstWordLower = words[0].toLowerCase();
                // If title starts with common article and has more than one word, use the second word
                if ((firstWordLower === 'the' || firstWordLower === 'a' || firstWordLower === 'an') && words.length > 1) {
                    descriptiveWord = words[1]; // Use second word
                } else {
                    descriptiveWord = words[0]; // Use first word
                }
            }
            // Sanitize the chosen word
            let sanitizedWord = descriptiveWord.replace(/[^a-zA-Z0-9]/g, '').substring(0, 15); // Remove non-alphanumeric, limit length
            if (!sanitizedWord) { sanitizedWord = 'Export'; } // Ensure fallback if word was only symbols etc.

            // Get date part YYYYMMDD
            const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            filename = `aob_export_${sanitizedWord}_${dateStamp}.csv`;
            console.log(`Generated filename: ${filename}`);
        } catch (e) {
            console.error("Error generating filename from title:", e);
            // Use a timestamp filename as fallback on error
            const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14);
            filename = `aob_export_${timestamp}.csv`;
        }
    } else {
        // Fallback if no books in session
        const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14);
        filename = `aob_export_${timestamp}.csv`;
    }
    // *** END FILENAME GENERATION ***

    if (link.download !== undefined) { const url = URL.createObjectURL(blob); link.setAttribute("href", url); link.setAttribute("download", filename); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); console.log("CSV download initiated."); } else { alert("CSV download not supported..."); }
}
if (exportCsvButton) { exportCsvButton.addEventListener('click', exportBooksToCsv); }
else { console.error("Export CSV button not found."); }
// --- End CSV Export Logic ---


// --- Initialize Page ---
initializeSku(); // Keep SKU initialization
renderSessionBooks(); // Render empty list
console.log("--- Script loaded (Hybrid V3 - Filename Article Skip) ---");
// No camera start needed


