'use strict';

// --- Global Variables ---
let sessionBooks = []; // Array to hold book objects added in this session

// --- Get references to HTML elements ---
const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
const captureButton = document.getElementById('captureButton'); // Single capture button
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
const constraints = {
    video: {
        facingMode: "environment"
    }
};

// --- SKU Generation Logic ---
// (Keep existing SKU functions: parseSkuPattern, generateNextSku, initializeSku)
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
    console.log("startCamera function entered...");
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        console.log("Camera stream started.");
    } catch (err) {
        console.error("Error accessing camera: ", err);
        alert("Could not access camera. Please ensure permission is granted and potentially using HTTPS.");
    }
}

// --- Capture Button Logic (Single Button) ---
if (captureButton) {
    captureButton.addEventListener('click', () => {
        console.log("Capture button clicked.");

        if (!video.srcObject || !video.srcObject.active) { console.error("Video stream not active."); alert("Camera stream not available."); return; }
        if (!video.videoWidth || !video.videoHeight) { console.error("Video dimensions not available."); alert("Video not ready yet."); return; }

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
            body: JSON.stringify({ image_data: imageDataUrl }), // No scan_type needed
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
                    // Clear fields not reliably parsed by basic backend yet
                    editionInput.value = '';
                    languageInput.value = 'English';
                    publisherInput.value = '';
                    releaseDateInput.value = '';
                    mediaInput.value = '';
                } else {
                    titleInput.value = ''; authorInput.value = ''; isbnInput.value = '';
                    editionInput.value = ''; languageInput.value = 'English';
                    publisherInput.value = ''; releaseDateInput.value = ''; mediaInput.value = '';
                }
                imageUrlInput.value = data.image_url || ''; // Use captured image URL

                // Clear/reset other manual entry fields
                conditionSelect.value = '3'; conditionTextInput.value = ''; priceInput.value = '';
                notesInput.value = ''; locationInput.value = ''; costInput.value = '';
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
} else { console.error("Capture button not found."); }
// --- End Capture Button Logic ---


// --- Function to update the displayed list of books ---
function renderSessionBooks() {
    if (!booksUl || !bookCountSpan) { console.error("Book list UL or Count Span not found."); return; }
    booksUl.innerHTML = '';
    bookCountSpan.innerText = sessionBooks.length;
    if (sessionBooks.length === 0) { booksUl.innerHTML = '<li>No books added yet.</li>'; return; }
    sessionBooks.forEach((book, index) => {
        const listItem = document.createElement('li');
        listItem.textContent = `[${index + 1}] ${book.sku}: ${book.title || 'N/A'} by ${book.author || 'N/A'} - Price: ${book.price || 'N/A'}`;
        booksUl.appendChild(listItem);
    });
}

// --- Add Book Button Logic ---
if (addBookButton) {
    addBookButton.addEventListener('click', () => {
        console.log("Add Book button clicked.");
        // (Keep existing validation and data collection logic...)
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

        if (!sku) { alert("SKU is required."); return; }
        if (!price) { alert("Price is required."); return; }
        const qtyInt = parseInt(qty, 10);
        if (isNaN(qtyInt) || qtyInt < 1) { alert("Quantity must be at least 1."); return; }
        if (!title && !isbn) { alert("Either Title or ISBN is required."); return; }

        // Create book data object using Zoobilee lowercase headers
        // Order matches the 'headers' array in exportBooksToCsv
        const bookData = {
            sku: sku,
            location: location, // Moved up per Zoobilee export order
            cost: cost ? parseFloat(cost) : null, // Moved up
            source: source, // Moved up
            isbn: isbn, // Moved up
            title: title,
            author: author,
            publisher: publisher,
            release_date: releaseDate,
            image: imageUrl, // Use 'image' key
            media: media,
            price: price,
            condition: parseInt(condition, 10),
            notes: notes, // Use 'notes'
            qty: qtyInt,
            cond_text: condText, // Use 'cond_text' key
            edition: edition,
            signature: isSigned ? "Signed" : "", // Use 'signature' key
            language: language
            // Add other keys like jcond_text, keywords, volume, weight later if needed
        };

        sessionBooks.push(bookData);
        console.log("Book added to session:", bookData);
        console.log("Session Books Array:", sessionBooks);

        renderSessionBooks(); // Update visual list

        alert(`Book '${bookData.title || bookData.sku}' added! (${sessionBooks.length} total in session)`);

        snapshotImg.src = '';
        snapshotImg.style.display = 'none';
    });
} else { console.error("Add Book button not found."); }
// --- End Add Book Button Logic ---


// --- Helper Button Logic ---
// (Keep existing helper button logic)
function setInputValue(elementId, value) {
    const inputElement = document.getElementById(elementId);
    if (inputElement) { inputElement.value = value; }
    else { console.error(`Element with ID ${elementId} not found for helper button.`); }
}
if (btn1stEd) { btn1stEd.addEventListener('click', () => setInputValue('edition', 'First Edition')); } else { console.warn("btn1stEd not found"); }
if (btnMediaPB) { btnMediaPB.addEventListener('click', () => setInputValue('media', 'Paperback')); } else { console.warn("btnMediaPB not found"); }
if (btnMediaHC) { btnMediaHC.addEventListener('click', () => setInputValue('media', 'Hardcover')); } else { console.warn("btnMediaHC not found"); }
if (btnMediaCD) { btnMediaCD.addEventListener('click', () => setInputValue('media', 'Audio CD')); } else { console.warn("btnMediaCD not found"); }
if (btnMediaDVD) { btnMediaDVD.addEventListener('click', () => setInputValue('media', 'DVD')); } else { console.warn("btnMediaDVD not found"); }
// --- End Helper Button Logic ---

// --- CSV Export Logic ---
function escapeCsvCell(value) {
    if (value == null) { return ''; }
    const stringValue = String(value);
    if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
}

function exportBooksToCsv() {
    if (sessionBooks.length === 0) {
        alert("No books have been added to the session list yet!");
        return;
    }
    console.log("Generating CSV for", sessionBooks.length, "books.");

    // *** UPDATED HEADER ORDER TO MATCH ZOOBILEE EXPORT ***
    const headers = [
        'sku', 'location', 'cost', 'source', 'isbn', 'title', 'author',
        'publisher', 'release_date', 'image', 'media', 'price', 'condition',
        'notes', 'qty', 'cond_text', 'edition', 'signature', 'language'
        // Add other headers here if needed, matching the order Zoobilee expects
    ];

    const headerRow = headers.map(escapeCsvCell).join(',');

    const dataRows = sessionBooks.map(book => {
        // Ensure data is pulled from bookData using the correct header key order
        return headers.map(header => escapeCsvCell(book[header])).join(',');
    });

    const csvContent = [headerRow, ...dataRows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14);
        link.setAttribute("href", url);
        link.setAttribute("download", `aob_export_${timestamp}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        console.log("CSV download initiated.");
    } else {
        alert("CSV download is not supported in this browser.");
    }
}
if (exportCsvButton) { exportCsvButton.addEventListener('click', exportBooksToCsv); }
else { console.error("Export CSV button not found."); }
// --- End CSV Export Logic ---


// --- Initialize Page ---
initializeSku(); // Check/prompt for SKU pattern on page load first
renderSessionBooks(); // Render empty list initially
console.log("--- Script loaded, attempting to start camera ---");
startCamera(); // Start camera after other initial setup
