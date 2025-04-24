'use strict';

// --- Global Variables ---
let sessionBooks = []; // Array to hold book objects added in this session
let lastBackendResponseData = null; // To store backend response (GCS URLs)
let imageBase64Data = { // Store base64 data from file uploads
    image_data_1: null,
    image_data_2: null
};

// --- Get references to HTML elements ---
// Elements for Hybrid V3 UI
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
const locationInput = document.getElementById('location');
const costInput = document.getElementById('cost');
const sourceInput = document.getElementById('source');
const imageUrlInput = document.getElementById('image_url'); // For image 1 GCS URL
const imageUrl2Input = document.getElementById('image_url_2'); // For image 2 GCS URL
const signedFlagCheckbox = document.getElementById('signed_flag');
const editionInput = document.getElementById('edition');
const languageInput = document.getElementById('language');
const volumeInput = document.getElementById('volume'); // Added volume field ref
const asin1Input = document.getElementById('asin1'); // Added ASIN field ref
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
        const maxFiles = Math.min(files.length, 2); // Process max 2 files
        let filesProcessed = 0;

        // Function to read a single file
        const readFile = (file, index) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                if (index === 0) {
                    imageBase64Data.image_data_1 = e.target.result; // Store base64 data URL
                    console.log("Image 1 loaded as base64.");
                    filePreviewDiv.innerHTML += `<div>File 1: ${file.name} (Primary)</div>`;
                } else if (index === 1) {
                    imageBase64Data.image_data_2 = e.target.result;
                    console.log("Image 2 loaded as base64.");
                     filePreviewDiv.innerHTML += `<div>File 2: ${file.name} (Secondary)</div>`;
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
        };

        // Read the first file, then the second if it exists
        if (maxFiles >= 1) readFile(files[0], 0);
        if (maxFiles >= 2) readFile(files[1], 1);

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

        // Expected header order from BVS GPT (10 fields, signature removed)
        // isbn,title,author,publisher,release_date,avg_price,asin1,edition,volume,language
        const expectedHeaders = ['isbn', 'title', 'author', 'publisher', 'release_date', 'price', 'asin1', 'edition', 'volume', 'language'];
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
            values.push(currentVal.trim()); // Add the last value
            const cleanedValues = values.map(v => v.replace(/^"|"$/g, '')); // Remove surrounding quotes
            console.log("Parsed values:", cleanedValues);

            if (cleanedValues.length !== numExpectedFields) { throw new Error(`Expected ${numExpectedFields} fields based on BVS format, but found ${cleanedValues.length}. Check pasted data.`); }

            // Populate form fields based on index from BVS output order
            isbnInput.value = cleanedValues[0] || '';
            titleInput.value = cleanedValues[1] || '';
            authorInput.value = cleanedValues[2] || '';
            publisherInput.value = cleanedValues[3] || '';
            releaseDateInput.value = cleanedValues[4] || ''; // Expecting YYYY
            priceInput.value = cleanedValues[5] || '50'; // Use avg_price from BVS
            asin1Input.value = cleanedValues[6] || ''; // Populate ASIN
            editionInput.value = cleanedValues[7] || '';
            volumeInput.value = cleanedValues[8] || ''; // Populate Volume
            languageInput.value = cleanedValues[9] || 'English';

            // Set defaults or clear other fields
            conditionSelect.value = '2'; // Default Very Good
            conditionTextInput.value = '';
            qtyInput.value = '1';
            notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK";
            mediaInput.value = '';
            const lastLocation = sessionStorage.getItem('lastLocation'); // Keep sticky location
            locationInput.value = lastLocation || '';
            costInput.value = '';
            sourceInput.value = '';
            signedFlagCheckbox.checked = false; // Reset signed status, user must check manually
            imageUrlInput.value = ''; // Clear GCS image URLs until uploaded
            imageUrl2Input.value = '';

            // Generate and populate SKU now
            const nextSku = generateNextSku();
            if (nextSku !== null) { skuInput.value = nextSku; } else { skuInput.value = ''; }
            console.log("SKU field populated.");


            console.log("Form fields populated from pasted data.");
            alert("Form populated! Please upload the corresponding image(s) now if you haven't already.");

        } catch (error) {
            console.error("Error parsing pasted data:", error);
            alert(`Error parsing pasted data: ${error.message}. Please ensure the data is a single CSV line with ${numExpectedFields} fields, correctly quoted.`);
        }
    });
} else { console.error("Populate From Text Button not found."); }


// --- Function to update the displayed list of books ---
function renderSessionBooks() { if (!booksUl || !bookCountSpan) { console.error("Book list UL/Span not found."); return; } booksUl.innerHTML = ''; bookCountSpan.innerText = sessionBooks.length; if (sessionBooks.length === 0) { booksUl.innerHTML = '<li>No books added yet.</li>'; return; } sessionBooks.forEach((book, index) => { const listItem = document.createElement('li'); listItem.textContent = `[${index + 1}] ${book.sku}: ${book.title || 'N/A'} by ${book.author || 'N/A'} - Price: ${book.price || 'N/A'}`; booksUl.appendChild(listItem); }); }

// --- Add Book Button Logic (Hybrid V3) ---
if (addBookButton) {
    addBookButton.addEventListener('click', () => {
        console.log("Add Book button clicked.");
        // SKU should already be populated from the 'Populate' step or manual entry
        const sku = skuInput.value.trim();
        if (!sku) {
            alert("SKU is missing. Please generate or enter one.");
            return;
        }
        // Check if image file(s) have been selected and processed into base64
        if (!imageBase64Data.image_data_1) {
            alert("Please upload the primary book image first using the 'Upload Image(s)' button.");
            return;
        }

        // Read other values from form
        const title = titleInput.value.trim(); const author = authorInput.value.trim();
        const isbn = isbnInput.value.trim(); const condition = conditionSelect.value; const condText = conditionTextInput.value.trim();
        const price = priceInput.value.trim(); const qty = qtyInput.value; const notes = notesInput.value.trim();
        const publisher = publisherInput.value.trim(); const releaseDate = releaseDateInput.value.trim(); const media = mediaInput.value.trim();
        const location = locationInput.value.trim(); const cost = costInput.value.trim(); const source = sourceInput.value.trim();
        const isSigned = signedFlagCheckbox.checked; const edition = editionInput.value.trim(); const language = languageInput.value.trim();
        const volume = volumeInput.value.trim(); const asin1 = asin1Input.value.trim(); // Read ASIN

        // Validation
        if (!price) { alert("Price required."); return; }
        const qtyInt = parseInt(qty, 10); if (isNaN(qtyInt) || qtyInt < 1) { alert("Qty must be >= 1."); return; }
        if (!title && !isbn && !asin1) { alert("Title, ISBN, or ASIN is required."); return; } // Adjusted validation

        // Prepare payload for backend (only image data needed for upload)
        const payload = {
            image_data_1: imageBase64Data.image_data_1,
            image_data_2: imageBase64Data.image_data_2 // Send second image if loaded
        };

        // --- Send Image Data to Backend for GCS Upload ---
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
                const gcsImageUrl2 = uploadData.image_url_2;

                // Determine product_id_type based on ASIN/ISBN presence
                let productIdType = '';
                if (asin1) { productIdType = '1'; } // ASIN
                else if (isbn && isbn.length === 13) { productIdType = '3'; } // ISBN-13
                else if (isbn && isbn.length === 10) { productIdType = '4'; } // ISBN-10
                // else leave blank or handle UPC if needed

                // Create book data object using form data + GCS URLs + Zoobilee headers
                const bookData = {
                    sku: sku, location: location, cost: cost ? parseFloat(cost) : null, source: source,
                    isbn: isbn, upc: "", // Add blank upc column if needed by Zoobilee
                    title: title, author: author, publisher: publisher, release_date: releaseDate,
                    image: gcsImageUrl1, media: media, price: price, condition: parseInt(condition, 10),
                    notes: notes, qty: qtyInt,
                    intl: "n", expd: "n", // Add defaults for these common flags? Check Zoobilee sample
                    listed_date: "", last_update: "", z_browse: "", z_category: "", z_shipping: "", z_storefront: "",
                    price_amz: "", price_abe: "", price_ali: "", weight: "0", flags: "", list_flags: "", reprice_flags: "",
                    stripped_title: "", ali_status: "",
                    product_id_type: productIdType, // Set based on ASIN/ISBN
                    asin1: asin1, asin2: "", asin3: "", // Add blank asin columns
                    p0:"", p1:"", p2:"", p3:"", p4:"", // Add blank p columns
                    cond_text: condText,
                    jcond_text: "", keywords: "", // Add blank jcond/keywords
                    edition: edition, signature: isSigned ? "Signed" : "", language: language, volume: volume
                    // Add other blank columns as needed to match Zoobilee export exactly
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
                skuInput.value = ''; titleInput.value = ''; authorInput.value = ''; isbnInput.value = '';
                publisherInput.value = ''; releaseDateInput.value = ''; editionInput.value = ''; volumeInput.value = '';
                asin1Input.value = ''; // Clear ASIN
                conditionTextInput.value = ''; mediaInput.value = ''; costInput.value = ''; sourceInput.value = '';
                imageUrlInput.value = ''; imageUrl2Input.value = ''; // Clear GCS URL display fields
                signedFlagCheckbox.checked = false;
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
    // *** Use FULL Zoobilee header order from sample file ***
    const headers = [
        'sku','location','cost','source','isbn','upc','title','author','publisher',
        'release_date','image','media','price','condition','notes','qty','intl',
        'expd','listed_date','last_update','z_browse','z_category','z_shipping',
        'z_storefront','price_amz','price_abe','price_ali','weight','flags',
        'list_flags','reprice_flags','stripped_title','ali_status',
        'product_id_type','asin1','asin2','asin3','p0','p1','p2','p3','p4',
        'cond_text','jcond_text','keywords','edition','signature','language','volume',
        'image_2' // Add image_2 near the end or where appropriate based on full sample
        // Add other headers if needed, ensure order matches Zoobilee
    ];
    // Ensure all headers exist as keys (even if blank) in bookData when adding books
    // Or handle missing keys gracefully here:
    const headerRow = headers.join(','); // Headers themselves usually don't need escaping
    const dataRows = sessionBooks.map(book => {
        return headers.map(header => escapeCsvCell(book[header] !== undefined ? book[header] : "")).join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");

    // Filename generation (Handles articles)
    let filename = 'aob_export.csv';
    if (sessionBooks.length > 0) {
        try {
            const firstBookTitle = sessionBooks[0].title || ''; let descriptiveWord = 'Export';
            const words = firstBookTitle.trim().split(/\s+/);
            if (words.length > 0 && words[0] !== '') {
                const firstWordLower = words[0].toLowerCase();
                if ((firstWordLower === 'the' || firstWordLower === 'a' || firstWordLower === 'an') && words.length > 1) {
                    descriptiveWord = words[1];
                } else { descriptiveWord = words[0]; }
            }
            let sanitizedWord = descriptiveWord.replace(/[^a-zA-Z0-9]/g, '').substring(0, 15);
            if (!sanitizedWord) { sanitizedWord = 'Export'; }
            const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
            filename = `aob_export_${sanitizedWord}_${dateStamp}.csv`;
            console.log(`Generated filename: ${filename}`);
        } catch (e) {
            console.error("Error generating filename:", e);
            const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14);
            filename = `aob_export_${timestamp}.csv`;
        }
    } else { const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14); filename = `aob_export_${timestamp}.csv`; }

    if (link.download !== undefined) { const url = URL.createObjectURL(blob); link.setAttribute("href", url); link.setAttribute("download", filename); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); console.log("CSV download initiated."); } else { alert("CSV download not supported..."); }
}
if (exportCsvButton) { exportCsvButton.addEventListener('click', exportBooksToCsv); }
else { console.error("Export CSV button not found."); }
// --- End CSV Export Logic ---


// --- Initialize Page ---
initializeSku(); // Keep SKU initialization
renderSessionBooks(); // Render empty list
console.log("--- Script loaded (Hybrid V3 - Final) ---");
// No camera start needed


