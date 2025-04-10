'use strict';

// --- Global Variables ---
let sessionBooks = []; // Array to hold book objects added in this session

// --- Get references to HTML elements ---
const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
const captureButton = document.getElementById('captureButton');
const snapshotImg = document.getElementById('snapshot');
const context = canvas.getContext('2d');

// Form Elements & Buttons
const addBookButton = document.getElementById('addBookButton');
const exportCsvButton = document.getElementById('exportCsvButton'); // Added Export Button
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
const constraints = {
    video: {
        facingMode: "environment"
    }
};

// --- SKU Generation Logic ---
function parseSkuPattern(startSku) {
    const match = startSku.match(/^(.+?)([0-9]+)$/);
    if (match && match[1] && match[2]) {
        const prefix = match[1];
        const numberStr = match[2];
        const number = parseInt(numberStr, 10);
        const padding = numberStr.length;
        sessionStorage.setItem('skuPrefix', prefix);
        sessionStorage.setItem('skuPadding', padding.toString());
        sessionStorage.setItem('lastSkuNumber', (number - 1).toString());
        console.log(`SKU Pattern Set: Prefix='${prefix}', StartNumber=${number}, Padding=${padding}`);
        return true;
    } else {
        alert("Invalid SKU pattern. Please use format like 'PREFIX-001' or 'ITEM100'.");
        return false;
    }
}

function generateNextSku() {
    const prefix = sessionStorage.getItem('skuPrefix');
    const paddingStr = sessionStorage.getItem('skuPadding');
    const lastNumberStr = sessionStorage.getItem('lastSkuNumber');
    if (prefix === null || paddingStr === null || lastNumberStr === null) {
        console.error("SKU pattern not initialized.");
        initializeSku(); // Re-prompt if not initialized
        const updatedPrefix = sessionStorage.getItem('skuPrefix');
         if (updatedPrefix === null) return null;
         return null;
    }
    const padding = parseInt(paddingStr, 10);
    const lastNumber = parseInt(lastNumberStr, 10);
    const nextNumber = lastNumber + 1;
    const nextNumberStr = String(nextNumber).padStart(padding, '0');
    sessionStorage.setItem('lastSkuNumber', nextNumber.toString());
    const nextSku = prefix + nextNumberStr;
    console.log(`Generated next SKU: ${nextSku}`);
    return nextSku;
}

function initializeSku() {
    if (sessionStorage.getItem('skuPrefix') === null) {
        const startSku = prompt("Enter starting SKU pattern (e.g., PREFIX-001 or ITEM100):");
        if (startSku) {
            if (!parseSkuPattern(startSku)) {
                sessionStorage.removeItem('skuPrefix');
                sessionStorage.removeItem('skuPadding');
                sessionStorage.removeItem('lastSkuNumber');
            }
        } else {
            alert("SKU generation skipped for this session.");
        }
    } else {
        console.log("SKU pattern already initialized for this session.");
    }
}
// --- End SKU Generation Logic ---

// --- Camera Start ---
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        console.log("Camera stream started.");
    } catch (err) {
        console.error("Error accessing camera: ", err);
        alert("Could not access camera. Please ensure permission is granted and potentially using HTTPS.");
    }
}

// --- Capture Button Logic ---
captureButton.addEventListener('click', () => {
    console.log("Capture button clicked.");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    snapshotImg.src = imageDataUrl;
    snapshotImg.style.display = 'block';
    console.log("Snapshot taken and displayed.");

    const nextSku = generateNextSku();
    if (nextSku !== null) { skuInput.value = nextSku; } else { skuInput.value = ''; }

    console.log("Attempting to send image data to deployed backend...");
    fetch('https://us-central1-aob-scanner.cloudfunctions.net/book-scanner-process-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_data: imageDataUrl }),
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

        // Populate Form Fields
        if (data) {
            if (data.parsed_fields) {
                titleInput.value = data.parsed_fields.title || '';
                authorInput.value = data.parsed_fields.author || '';
                isbnInput.value = data.parsed_fields.isbn || '';
                editionInput.value = data.parsed_fields.edition || ''; // If backend parses edition
                languageInput.value = data.parsed_fields.language || 'English'; // If backend parses language
            } else {
                titleInput.value = ''; authorInput.value = ''; isbnInput.value = '';
                editionInput.value = ''; languageInput.value = 'English';
            }
            imageUrlInput.value = data.image_url || '';
            // Clear/reset other manual fields
            conditionSelect.value = '3'; conditionTextInput.value = ''; priceInput.value = '';
            notesInput.value = ''; publisherInput.value = ''; releaseDateInput.value = '';
            mediaInput.value = ''; locationInput.value = ''; costInput.value = '';
            sourceInput.value = ''; signedFlagCheckbox.checked = false;
            console.log("Relevant form fields populated/reset after capture.");
        }
        alert("Image processed! Review details and click 'Add Book'.");
    })
    .catch((error) => {
        console.error('Error sending image to backend:', error);
        alert(`Failed to process image. Error: ${error.message}. Check browser console.`);
    });
});

// --- Add Book Button Logic ---
addBookButton.addEventListener('click', () => {
    console.log("Add Book button clicked.");

    // Read all current form values
    const sku = skuInput.value.trim();
    const title = titleInput.value.trim();
    const author = authorInput.value.trim();
    const isbn = isbnInput.value.trim();
    const condition = conditionSelect.value;
    const condText = conditionTextInput.value.trim();
    const price = priceInput.value.trim();
    const qty = qtyInput.value;
    const notes = notesInput.value.trim();
    const publisher = publisherInput.value.trim();
    const releaseDate = releaseDateInput.value.trim();
    const media = mediaInput.value.trim();
    const location = locationInput.value.trim();
    const cost = costInput.value.trim();
    const source = sourceInput.value.trim();
    const imageUrl = imageUrlInput.value.trim();
    const isSigned = signedFlagCheckbox.checked;
    const edition = editionInput.value.trim();
    const language = languageInput.value.trim();

    // Basic Validation
    if (!sku) { alert("SKU is required."); return; }
    if (!price) { alert("Price is required."); return; }
    const qtyInt = parseInt(qty, 10);
    if (isNaN(qtyInt) || qtyInt < 1) { alert("Quantity must be at least 1."); return; }
    if (!title && !isbn) { alert("Either Title or ISBN is required."); return; }

    // Create book data object using Zoobilee lowercase headers
    const bookData = {
        sku: sku, title: title, author: author, isbn: isbn,
        condition: parseInt(condition, 10), cond_text: condText, price: price, qty: qtyInt,
        notes: notes, publisher: publisher, release_date: releaseDate, media: media,
        location: location, cost: cost ? parseFloat(cost) : null, source: source,
        image: imageUrl, signature: isSigned ? "Signed" : "", edition: edition, language: language
    };

    // Add to session array
    sessionBooks.push(bookData);
    console.log("Book added to session:", bookData);
    console.log("Session Books Array:", sessionBooks);

    // Update UI feedback
    bookCountSpan.innerText = sessionBooks.length;
    const listItem = document.createElement('li');
    listItem.textContent = `${bookData.sku}: ${bookData.title || bookData.isbn}`;
    booksUl.appendChild(listItem);

    alert(`Book '${bookData.title || bookData.sku}' added! (${sessionBooks.length} total in session)`);

    // Prepare for next entry
    snapshotImg.src = '';
    snapshotImg.style.display = 'none';
    // Auto-SKU should be generated on next capture. Other fields cleared post-fetch.

});
// --- End Add Book Button Logic ---

// --- Helper Button Logic ---
function setInputValue(elementId, value) {
    const inputElement = document.getElementById(elementId);
    if (inputElement) { inputElement.value = value; }
    else { console.error(`Element with ID ${elementId} not found for helper button.`); }
}
if (btn1stEd) { btn1stEd.addEventListener('click', () => setInputValue('edition', 'First Edition')); }
if (btnMediaPB) { btnMediaPB.addEventListener('click', () => setInputValue('media', 'Paperback')); }
if (btnMediaHC) { btnMediaHC.addEventListener('click', () => setInputValue('media', 'Hardcover')); }
if (btnMediaCD) { btnMediaCD.addEventListener('click', () => setInputValue('media', 'Audio CD')); }
if (btnMediaDVD) { btnMediaDVD.addEventListener('click', () => setInputValue('media', 'DVD')); }
// --- End Helper Button Logic ---

// --- CSV Export Logic ---
function escapeCsvCell(value) {
    if (value == null) { // Handles null or undefined
        return '';
    }
    const stringValue = String(value);
    // Check if quoting is necessary: contains comma, newline, or double quote
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        // Escape double quotes by doubling them and wrap everything in double quotes
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    // If no quoting necessary, return the string as is
    return stringValue;
}

function exportBooksToCsv() {
    if (sessionBooks.length === 0) {
        alert("No books have been added to the session list yet!");
        return;
    }

    console.log("Generating CSV for", sessionBooks.length, "books.");

    // Define headers based on Zoobilee spec / bookData keys (ensure order matches desired output)
    const headers = [
        'sku', 'title', 'author', 'isbn', 'condition', 'cond_text', 'price', 'qty',
        'notes', 'publisher', 'release_date', 'media', 'location', 'cost', 'source',
        'image', 'signature', 'edition', 'language'
        // Add any other headers needed by Zoobilee in the correct order here
    ];

    const headerRow = headers.map(escapeCsvCell).join(','); // Escape headers just in case

    const dataRows = sessionBooks.map(book => {
        // Map book data object to the header order, escaping each cell
        return headers.map(header => escapeCsvCell(book[header])).join(',');
    });

    // Combine header and data rows
    const csvContent = [headerRow, ...dataRows].join('\n');

    // Create Blob and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) { // Feature detection
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14); // YYYYMMDDHHMMSS
        link.setAttribute("href", url);
        link.setAttribute("download", `aob_export_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // Clean up Blob URL
        console.log("CSV download initiated.");
    } else {
        alert("CSV download is not supported in this browser.");
    }
}

// Add event listener for the export button
if (exportCsvButton) {
    exportCsvButton.addEventListener('click', exportBooksToCsv);
} else {
    console.error("Export CSV button not found.");
}
// --- End CSV Export Logic ---


// --- Initialize Page ---
startCamera();
initializeSku(); // Check/prompt for SKU pattern on page load
