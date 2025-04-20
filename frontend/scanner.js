'use strict';

// --- Global Variables ---
let sessionBooks = []; // Array to hold book objects added in this session
let lastBackendResponseData = null; // To store the most recent backend response for image_url_2 access

// --- Get references to HTML elements ---
const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
const captureButton = document.getElementById('captureButton'); // Single capture button ID
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
const locationInput = document.getElementById('location'); // Location input
const costInput = document.getElementById('cost');
const sourceInput = document.getElementById('source');
const imageUrlInput = document.getElementById('image_url'); // For image 1
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
// (Keep existing SKU functions: parseSkuPattern, generateNextSku, initializeSku)
function parseSkuPattern(startSku) { const match = startSku.match(/^(.+?)([0-9]+)$/); if (match && match[1] && match[2]) { const prefix = match[1]; const numberStr = match[2]; const number = parseInt(numberStr, 10); const padding = numberStr.length; sessionStorage.setItem('skuPrefix', prefix); sessionStorage.setItem('skuPadding', padding.toString()); sessionStorage.setItem('lastSkuNumber', (number - 1).toString()); console.log(`SKU Pattern Set: Prefix='${prefix}', StartNumber=${number}, Padding=${padding}`); return true; } else { alert("Invalid SKU pattern..."); return false; } }
function generateNextSku() { const prefix = sessionStorage.getItem('skuPrefix'); const paddingStr = sessionStorage.getItem('skuPadding'); const lastNumberStr = sessionStorage.getItem('lastSkuNumber'); if (prefix === null || paddingStr === null || lastNumberStr === null) { console.error("SKU pattern not initialized."); initializeSku(); const updatedPrefix = sessionStorage.getItem('skuPrefix'); if (updatedPrefix === null) return null; return null; } const padding = parseInt(paddingStr, 10); const lastNumber = parseInt(lastNumberStr, 10); const nextNumber = lastNumber + 1; const nextNumberStr = String(nextNumber).padStart(padding, '0'); sessionStorage.setItem('lastSkuNumber', nextNumber.toString()); const nextSku = prefix + nextNumberStr; console.log(`Generated next SKU: ${nextSku}`); return nextSku; }
function initializeSku() { if (sessionStorage.getItem('skuPrefix') === null) { const startSku = prompt("Enter starting SKU pattern (e.g., PREFIX-001 or ITEM100):"); if (startSku) { if (!parseSkuPattern(startSku)) { sessionStorage.removeItem('skuPrefix'); sessionStorage.removeItem('skuPadding'); sessionStorage.removeItem('lastSkuNumber'); } } else { alert("SKU generation skipped..."); } } else { console.log("SKU pattern already initialized..."); } }
// --- End SKU Generation Logic ---

// --- Camera Start ---
async function startCamera() { console.log("startCamera function entered..."); try { const stream = await navigator.mediaDevices.getUserMedia(constraints); video.srcObject = stream; console.log("Camera stream started."); } catch (err) { console.error("Error accessing camera: ", err); alert("Could not access camera..."); } }

// --- Capture Button Logic (V2 - Single Button -> Prompt -> Optional Second Capture) ---
if (captureButton) {
    captureButton.addEventListener('click', async () => { // Make listener async
        console.log("Capture button clicked (Stage 1 - Cover/Primary).");

        if (!video.srcObject || !video.srcObject.active) { console.error("Video stream not active."); alert("Camera stream not available."); return; }
        if (!video.videoWidth || !video.videoHeight) { console.error("Video dimensions not available."); alert("Video not ready yet."); return; }

        // --- Capture Image 1 ---
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataUrl1 = canvas.toDataURL('image/jpeg', 0.9);
        snapshotImg.src = imageDataUrl1; // Show first snapshot
        snapshotImg.style.display = 'block';
        console.log("Snapshot 1 taken.");

        let imageDataUrl2 = null; // Initialize second image data as null

        // --- Prompt for Second Image ---
        await new Promise(resolve => setTimeout(resolve, 100)); // Allow UI to update before blocking confirm
        if (confirm("Capture barcode/copyright page for more details? (Optional)")) {
            alert("Position camera for second shot (barcode/copyright) and click OK when ready.");
            // --- Capture Image 2 ---
             try {
                  if (!video.srcObject || !video.srcObject.active) { throw new Error("Video stream stopped."); }
                  if (!video.videoWidth || !video.videoHeight) { throw new Error("Video dimensions lost."); }
                  console.log("Capturing second image...");
                  context.drawImage(video, 0, 0, canvas.width, canvas.height); // Re-draw from live feed
                  imageDataUrl2 = canvas.toDataURL('image/jpeg', 0.9);
                  console.log("Snapshot 2 taken.");
             } catch (capture2Error) {
                  console.error("Error capturing second image:", capture2Error);
                  alert("Failed to capture second image. Proceeding with first image only.");
                  imageDataUrl2 = null; // Ensure null if capture failed
             }
        } else {
            console.log("Second image skipped by user.");
        }

        // --- Prepare Payload ---
        const payload = {
            image_data_1: imageDataUrl1,
            image_data_2: imageDataUrl2 // Send image 2 (will be null if skipped/failed)
        };

        // --- Send Data to Backend ---
        console.log("Attempting to send image data (1 or 2 images) to deployed backend...");
        // Use the deployed function URL
        const backendUrl = 'https://us-central1-aob-scanner.cloudfunctions.net/book-scanner-process-image';
        fetch(backendUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        })
        .then(response => {
            if (!response.ok) {
                 return response.json().then(errData => {
                     throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Unknown backend error'}`);
                 }).catch(() => {
                     throw new Error(`HTTP error! status: ${response.status}`);
                 });
            }
            return response.json();
        })
        .then(data => {
             console.log('Data received from backend:', data);
             lastBackendResponseData = data; // Store full response for image_2 access later

             // --- Populate Form Fields & Apply Defaults ---
             if (data) {
                  // Generate and Set SKU AFTER fetch completes
                  const nextSku = generateNextSku();
                  if (nextSku !== null) { skuInput.value = nextSku; } else { skuInput.value = ''; }
                  console.log("SKU field populated.");

                  // Populate fields from Gemini results
                  const fields = data.parsed_fields || {}; // Use empty object if parsed_fields is missing
                  titleInput.value = fields.title || '';
                  authorInput.value = fields.author || '';
                  isbnInput.value = fields.isbn || '';
                  publisherInput.value = fields.publisher || '';
                  releaseDateInput.value = fields.release_date || ''; // Expecting YYYY from backend
                  languageInput.value = fields.language || 'English'; // Default to English if null
                  editionInput.value = fields.edition || '';
                  // Set checkbox based on signature field (expecting "Signed" or null/other)
                  signedFlagCheckbox.checked = !!(fields.signature && fields.signature.toLowerCase() === 'signed');
                  // Populate price using estimate OR default '50'
                  priceInput.value = fields.price || '50';
                  // Populate image URL (should be image_url_1 from backend)
                  imageUrlInput.value = data.image_url || '';

                  // Set Defaults / Clear only non-AI fields
                  conditionSelect.value = '2'; // Default: Very Good
                  notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK"; // Default Notes
                  qtyInput.value = '1'; // Reset quantity

                  // ** Load Sticky Location **
                  const lastLocation = sessionStorage.getItem('lastLocation');
                  locationInput.value = lastLocation || ''; // Use saved value or empty string
                  console.log(`Populated location with last used: ${locationInput.value}`);
                  // ** End Sticky Location **

                  // Clear other specific manual fields
                  conditionTextInput.value = '';
                  mediaInput.value = '';
                  // locationInput.value = ''; // Don't clear location here, handled by sticky logic above
                  costInput.value = '';
                  sourceInput.value = '';

                  console.log("Form fields populated/reset after capture.");

                  // Report backend errors clearly
                  if (data.gcs_error) { console.error("GCS Error:", data.gcs_error); alert(`GCS Error: ${data.gcs_error}`); }
                  if (data.gemini_error) { console.error("Gemini Error:", data.gemini_error); alert(`Gemini AI Error: ${data.gemini_error}`); }
                  if (data.lookup_error) { console.warn("Lookup Warning:", data.lookup_error); } // Use warn for lookup issues

             } else {
                  console.error("Received no data object from backend.");
                  alert("Error: Received no data from backend.");
             }
             // --- End Populate/Reset Form Fields ---

             alert("Image(s) processed! Review details and click 'Add Book'."); // Simplified alert
        })
        .catch(error => {
            console.error('Error sending image(s) to backend:', error);
            alert(`Failed to process image(s). Error: ${error.message}. Check browser console.`);
        });
    });
} else {
    console.error("Capture button (ID: captureButton) not found in HTML.");
}
// --- End Capture Button Logic ---


// --- Function to update the displayed list of books ---
function renderSessionBooks() { if (!booksUl || !bookCountSpan) { console.error("Book list UL/Span not found."); return; } booksUl.innerHTML = ''; bookCountSpan.innerText = sessionBooks.length; if (sessionBooks.length === 0) { booksUl.innerHTML = '<li>No books added yet.</li>'; return; } sessionBooks.forEach((book, index) => { const listItem = document.createElement('li'); listItem.textContent = `[${index + 1}] ${book.sku}: ${book.title || 'N/A'} by ${book.author || 'N/A'} - Price: ${book.price || 'N/A'}`; booksUl.appendChild(listItem); }); }

// --- Add Book Button Logic ---
if (addBookButton) {
    addBookButton.addEventListener('click', () => {
        console.log("Add Book button clicked.");
        // Read values from form
        const sku = skuInput.value.trim(); const title = titleInput.value.trim(); const author = authorInput.value.trim();
        const isbn = isbnInput.value.trim(); const condition = conditionSelect.value; const condText = conditionTextInput.value.trim();
        const price = priceInput.value.trim(); const qty = qtyInput.value; const notes = notesInput.value.trim();
        const publisher = publisherInput.value.trim(); const releaseDate = releaseDateInput.value.trim(); const media = mediaInput.value.trim();
        const location = locationInput.value.trim(); const cost = costInput.value.trim(); const source = sourceInput.value.trim();
        const imageUrl = imageUrlInput.value.trim(); // Image 1 URL from form
        const isSigned = signedFlagCheckbox.checked; const edition = editionInput.value.trim(); const language = languageInput.value.trim();
        const imageUrl2 = lastBackendResponseData ? lastBackendResponseData.image_url_2 : null; // Get Image 2 URL from stored response

        // Validation
        if (!sku) { alert("SKU required."); return; } if (!price) { alert("Price required."); return; }
        const qtyInt = parseInt(qty, 10); if (isNaN(qtyInt) || qtyInt < 1) { alert("Qty must be >= 1."); return; }
        if (!title && !isbn) { alert("Title or ISBN required."); return; }

        // Create book data object matching Zoobilee CSV headers/order
        const bookData = {
            sku: sku, location: location, cost: cost ? parseFloat(cost) : null, source: source,
            isbn: isbn, title: title, author: author, publisher: publisher, release_date: releaseDate,
            image: imageUrl, image_2: imageUrl2 || "", media: media, price: price,
            condition: parseInt(condition, 10), notes: notes, qty: qtyInt, cond_text: condText,
            edition: edition, signature: isSigned ? "Signed" : "", language: language
        };

        sessionBooks.push(bookData);
        console.log("Book added:", bookData); console.log("Session Array:", sessionBooks);

        // Save location for next time
        if (location) { sessionStorage.setItem('lastLocation', location); console.log(`Saved last location: ${location}`); }

        renderSessionBooks(); // Update visual list
        alert(`Book '${bookData.title || bookData.sku}' added! (${sessionBooks.length} total)`);

        // --- Clear/Reset Form for Next Entry ---
        console.log("Clearing form fields after adding book...");
        snapshotImg.src = ''; snapshotImg.style.display = 'none'; // Clear snapshot
        lastBackendResponseData = null; // Clear stored response

        // Clear specific fields
        skuInput.value = ''; // Clear SKU, new one generated on next capture
        titleInput.value = '';
        authorInput.value = '';
        isbnInput.value = '';
        publisherInput.value = '';
        releaseDateInput.value = '';
        editionInput.value = '';
        conditionTextInput.value = '';
        mediaInput.value = '';
        costInput.value = '';
        sourceInput.value = '';
        imageUrlInput.value = '';
        signedFlagCheckbox.checked = false;
        // Reset fields to defaults
        conditionSelect.value = '2'; // Very Good
        priceInput.value = '50'; // Default price
        notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK"; // Default notes
        qtyInput.value = '1';
        languageInput.value = 'English';
        // locationInput.value = ''; // Keep location populated by sticky feature (it gets repopulated on next scan anyway)
        console.log("Form cleared/reset.");
        // --- End Form Clear/Reset ---

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
function exportBooksToCsv() { if (sessionBooks.length === 0) { alert("No books added..."); return; } console.log("Generating CSV..."); const headers = ['sku', 'location', 'cost', 'source', 'isbn', 'title', 'author', 'publisher', 'release_date', 'image', 'image_2', 'media', 'price', 'condition', 'notes', 'qty', 'cond_text', 'edition', 'signature', 'language']; const headerRow = headers.map(escapeCsvCell).join(','); const dataRows = sessionBooks.map(book => { return headers.map(header => escapeCsvCell(book[header])).join(','); }); const csvContent = [headerRow, ...dataRows].join('\n'); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); if (link.download !== undefined) { const url = URL.createObjectURL(blob); const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14); link.setAttribute("href", url); link.setAttribute("download", `aob_export_${timestamp}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); console.log("CSV download initiated."); } else { alert("CSV download not supported..."); } }
if (exportCsvButton) { exportCsvButton.addEventListener('click', exportBooksToCsv); }
else { console.error("Export CSV button not found."); }
// --- End CSV Export Logic ---


// --- Initialize Page ---
initializeSku();
renderSessionBooks();
console.log("--- Script loaded, attempting to start camera ---");
startCamera();


