'use strict';

// --- Global Variables ---
let sessionBooks = []; // Array to hold book objects added in this session

// --- Get references to HTML elements ---
const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
// Use IDs for the two new buttons
const captureCoverButton = document.getElementById('captureCoverButton');
const captureBarcodeButton = document.getElementById('captureBarcodeButton');
const snapshotImg = document.getElementById('snapshot');
const context = canvas.getContext('2d');

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
const imageUrlInput = document.getElementById('image_url');
const signedFlagCheckbox = document.getElementById('signed_flag');
const editionInput = document.getElementById('edition');
const languageInput = document.getElementById('language');
// Helper button references
const btn1stEd = document.getElementById('btn1stEd');
const btnMediaPB = document.getElementById('btnMediaPB');
const btnMediaHC = document.getElementById('btnMediaHC');
const btnMediaCD = document.getElementById('btnMediaCD');
const btnMediaDVD = document.getElementById('btnMediaDVD');

// --- Camera Constraints ---
const constraints = { video: { facingMode: "environment" } };

// --- SKU Generation Logic ---
function parseSkuPattern(startSku) { /* ... same as before ... */ const match = startSku.match(/^(.+?)([0-9]+)$/); if (match && match[1] && match[2]) { const prefix = match[1]; const numberStr = match[2]; const number = parseInt(numberStr, 10); const padding = numberStr.length; sessionStorage.setItem('skuPrefix', prefix); sessionStorage.setItem('skuPadding', padding.toString()); sessionStorage.setItem('lastSkuNumber', (number - 1).toString()); console.log(`SKU Pattern Set: Prefix='<span class="math-inline">\{prefix\}', StartNumber\=</span>{number}, Padding=${padding}`); return true; } else { alert("Invalid SKU pattern..."); return false; } }
function generateNextSku() { /* ... same as before ... */ const prefix = sessionStorage.getItem('skuPrefix'); const paddingStr = sessionStorage.getItem('skuPadding'); const lastNumberStr = sessionStorage.getItem('lastSkuNumber'); if (prefix === null || paddingStr === null || lastNumberStr === null) { console.error("SKU pattern not initialized."); initializeSku(); const updatedPrefix = sessionStorage.getItem('skuPrefix'); if (updatedPrefix === null) return null; return null; } const padding = parseInt(paddingStr, 10); const lastNumber = parseInt(lastNumberStr, 10); const nextNumber = lastNumber + 1; const nextNumberStr = String(nextNumber).padStart(padding, '0'); sessionStorage.setItem('lastSkuNumber', nextNumber.toString()); const nextSku = prefix + nextNumberStr; console.log(`Generated next SKU: ${nextSku}`); return nextSku; }
function initializeSku() { /* ... same as before ... */ if (sessionStorage.getItem('skuPrefix') === null) { const startSku = prompt("Enter starting SKU pattern (e.g., PREFIX-001 or ITEM100):"); if (startSku) { if (!parseSkuPattern(startSku)) { sessionStorage.removeItem('skuPrefix'); sessionStorage.removeItem('skuPadding'); sessionStorage.removeItem('lastSkuNumber'); } } else { alert("SKU generation skipped..."); } } else { console.log("SKU pattern already initialized..."); } }
// --- End SKU Generation Logic ---

// --- Camera Start ---
async function startCamera() { /* ... same as before ... */ console.log("startCamera function entered..."); try { const stream = await navigator.mediaDevices.getUserMedia(constraints); video.srcObject = stream; console.log("Camera stream started."); } catch (err) { console.error("Error accessing camera: ", err); alert("Could not access camera..."); } }

// --- Shared Function for Capturing and Sending Data ---
function captureAndSend(scanType) {
    console.log(`Capture button clicked for type: ${scanType}`);
    if (!video.srcObject || !video.srcObject.active) { console.error("Video stream not active."); alert("Camera stream not available."); return; }
    if (!video.videoWidth || !video.videoHeight) { console.error("Video dimensions not available."); alert("Video not ready yet."); return; }

    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    snapshotImg.src = imageDataUrl; snapshotImg.style.display = 'block';
    console.log("Snapshot taken and displayed.");

    const nextSku = generateNextSku();
    if (nextSku !== null) { skuInput.value = nextSku; } else { skuInput.value = ''; }

    console.log("Attempting to send image data to deployed backend...");
    fetch('https://us-central1-aob-scanner.cloudfunctions.net/book-scanner-process-image', { // Use deployed URL
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image_data: imageDataUrl,
            scan_type: scanType // Send scan type
        }),
    })
    .then(response => {
        if (!response.ok) {
             return response.json().then(errData => { throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Unknown error'}`); })
                           .catch(() => { throw new Error(`HTTP error! status: ${response.status}`); });
        }
        return response.json();
    })
    .then(data => {
        console.log('Data received from backend:', data);

        // --- Populate Form Fields from Backend Response ---
        if (data) {
            const fields = data.parsed_fields || {}; // Use empty obj if missing

            // Populate fields found by Gemini (or null if not found)
            titleInput.value = fields.title || '';
            authorInput.value = fields.author || '';
            isbnInput.value = fields.isbn || '';
            publisherInput.value = fields.publisher || '';
            releaseDateInput.value = fields.release_date || '';
            languageInput.value = fields.language || 'English'; // Default if null
            editionInput.value = fields.edition || '';
            // Handle signature checkbox based on text returned
            signedFlagCheckbox.checked = !!(fields.signature && fields.signature.toLowerCase().includes('sign'));

            // Populate image URL (use 'image_url' from response which might be stock or captured based on backend)
            imageUrlInput.value = data.image_url || '';

            // Clear/Reset *other* manual fields and set defaults
            conditionSelect.value = '2'; // Set default to Very Good
            conditionTextInput.value = '';
            priceInput.value = '50'; // Set default price
            notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK"; // Set default notes
            qtyInput.value = '1';
            mediaInput.value = ''; // Clear media
            locationInput.value = '';
            costInput.value = '';
            sourceInput.value = '';

            console.log("Form fields populated/reset after capture.");

            // Report any errors from backend
            if (data.gcs_error) { console.error("GCS Error:", data.gcs_error); }
            if (data.gemini_error) { console.error("Gemini Error:", data.gemini_error); }

        } else { console.error("Received no data object from backend."); }
        // --- End Populate/Reset Form Fields ---

        alert("Image processed! Review details and click 'Add Book'.");
    })
    .catch((error) => {
        console.error('Error sending image to backend:', error);
        alert(`Failed to process image. Error: ${error.message}. Check browser console.`);
    });
}

// --- Attach Listeners to NEW Capture Buttons ---
if (captureCoverButton) { captureCoverButton.addEventListener('click', () => captureAndSend('cover')); }
else { console.error("Capture Cover Button not found"); }
if (captureBarcodeButton) { captureBarcodeButton.addEventListener('click', () => captureAndSend('barcode')); }
else { console.error("Capture Barcode Button not found"); }
// --- End New Capture Button Listeners ---

// --- Function to update the displayed list of books ---
function renderSessionBooks() { /* ... same as before ... */ if (!booksUl || !bookCountSpan) { console.error("Book list UL/Span not found."); return; } booksUl.innerHTML = ''; bookCountSpan.innerText = sessionBooks.length; if (sessionBooks.length === 0) { booksUl.innerHTML = '<li>No books added yet.</li>'; return; } sessionBooks.forEach((book, index) => { const listItem = document.createElement('li'); listItem.textContent = `[${index + 1}] ${book.sku}: ${book.title || 'N/A'} by ${book.author || 'N/A'} - Price: ${book.price || 'N/A'}`; booksUl.appendChild(listItem); }); }

// --- Add Book Button Logic ---
if (addBookButton) { addBookButton.addEventListener('click', () => { /* ... same as before ... */ console.log("Add Book clicked."); const sku = skuInput.value.trim(); const title = titleInput.value.trim(); const author = authorInput.value.trim(); const isbn = isbnInput.value.trim(); const condition = conditionSelect.value; const condText = conditionTextInput.value.trim(); const price = priceInput.value.trim(); const qty = qtyInput.value; const notes = notesInput.value.trim(); const publisher = publisherInput.value.trim(); const releaseDate = releaseDateInput.value.trim(); const media = mediaInput.value.trim(); const location = locationInput.value.trim(); const cost = costInput.value.trim(); const source = sourceInput.value.trim(); const imageUrl = imageUrlInput.value.trim(); const isSigned = signedFlagCheckbox.checked; const edition = editionInput.value.trim(); const language = languageInput.value.trim(); if (!sku) { alert("SKU required."); return; } if (!price) { alert("Price required."); return; } const qtyInt = parseInt(qty, 10); if (isNaN(qtyInt) || qtyInt < 1) { alert("Qty must be >= 1."); return; } if (!title && !isbn) { alert("Title or ISBN required."); return; } const bookData = { sku: sku, location: location, cost: cost ? parseFloat(cost) : null, source: source, isbn: isbn, title: title, author: author, publisher: publisher, release_date: releaseDate, image: imageUrl, media: media, price: price, condition: parseInt(condition, 10), notes: notes, qty: qtyInt, cond_text: condText, edition: edition, signature: isSigned ? "Signed" : "", language: language }; sessionBooks.push(bookData); console.log("Book added:", bookData); console.log("Session Array:", sessionBooks); renderSessionBooks(); alert(`Book '<span class="math-inline">\{bookData\.title \|\| bookData\.sku\}' added\! \(</span>{sessionBooks.length} total)`); snapshotImg.src = ''; snapshotImg.style.display = 'none'; }); } else { console.error("Add Book button not found."); }
// --- End Add Book Button Logic ---

// --- Helper Button Logic ---
function setInputValue(elementId, value) { /* ... same as before ... */ const inputElement = document.getElementById(elementId); if (inputElement) { inputElement.value = value; } else { console.error(`Element ID ${elementId} not found.`); } }
if (btn1stEd) { btn1stEd.addEventListener('click', () => setInputValue('edition', 'First Edition')); } else { console.warn("btn1stEd not found"); }
if (btnMediaPB) { btnMediaPB.addEventListener('click', () => setInputValue('media', 'Paperback')); } else { console.warn("btnMediaPB not found"); }
if (btnMediaHC) { btnMediaHC.addEventListener('click', () => setInputValue('media', 'Hardcover')); } else { console.warn("btnMediaHC not found"); }
if (btnMediaCD) { btnMediaCD.addEventListener('click', () => setInputValue('media', 'Audio CD')); } else { console.warn("btnMediaCD not found"); }
if (btnMediaDVD) { btnMediaDVD.addEventListener('click', () => setInputValue('media', 'DVD')); } else { console.warn("btnMediaDVD not found"); }
// --- End Helper Button Logic ---

// --- CSV Export Logic ---
function escapeCsvCell(value) { /* ... same as before ... */ if (value == null) { return ''; } const stringValue = String(value); if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) { return `"${stringValue.replace(/"/g, '""')}"`; } return stringValue; }
function exportBooksToCsv() { /* ... same as before ... */ if (sessionBooks.length === 0) { alert("No books added..."); return; } console.log("Generating CSV..."); const headers = ['sku', 'location', 'cost', 'source', 'isbn', 'title', 'author', 'publisher', 'release_date', 'image', 'media', 'price', 'condition', 'notes', 'qty', 'cond_text', 'edition', 'signature', 'language']; const headerRow = headers.map(escapeCsvCell).join(','); const dataRows = sessionBooks.map(book => { return headers.map(header => escapeCsvCell(book[header])).join(','); }); const csvContent = [headerRow, ...dataRows].join('\n'); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); if (link.download !== undefined) { const url = URL.createObjectURL(blob); const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14); link.setAttribute("href", url); link.setAttribute("download", `aob_export_${timestamp}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); console.log("CSV download initiated."); } else { alert("CSV download not supported..."); } }
if (exportCsvButton) { exportCsvButton.addEventListener('click', exportBooksToCsv); }
else { console.error("Export CSV button not found."); }
// --- End CSV Export Logic ---

// --- Initialize Page ---
initializeSku();
renderSessionBooks();
console.log("--- Script loaded, attempting to start camera ---");
startCamera();
