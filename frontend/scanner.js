'use strict';

// --- Global Variables ---
let sessionBooks = [];
let lastBackendResponseData = null;

// --- Get references to HTML elements ---
const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
const captureButton = document.getElementById('captureButton');
const snapshotImg = document.getElementById('snapshot');
const context = canvas.getContext('2d');
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
function parseSkuPattern(startSku) { const match = startSku.match(/^(.+?)([0-9]+)$/); if (match && match[1] && match[2]) { const prefix = match[1]; const numberStr = match[2]; const number = parseInt(numberStr, 10); const padding = numberStr.length; sessionStorage.setItem('skuPrefix', prefix); sessionStorage.setItem('skuPadding', padding.toString()); sessionStorage.setItem('lastSkuNumber', (number - 1).toString()); console.log(`SKU Pattern Set: Prefix='${prefix}', StartNumber=${number}, Padding=${padding}`); return true; } else { alert("Invalid SKU pattern..."); return false; } }
function generateNextSku() { const prefix = sessionStorage.getItem('skuPrefix'); const paddingStr = sessionStorage.getItem('skuPadding'); const lastNumberStr = sessionStorage.getItem('lastSkuNumber'); if (prefix === null || paddingStr === null || lastNumberStr === null) { console.error("SKU pattern not initialized."); initializeSku(); const updatedPrefix = sessionStorage.getItem('skuPrefix'); if (updatedPrefix === null) return null; return null; } const padding = parseInt(paddingStr, 10); const lastNumber = parseInt(lastNumberStr, 10); const nextNumber = lastNumber + 1; const nextNumberStr = String(nextNumber).padStart(padding, '0'); sessionStorage.setItem('lastSkuNumber', nextNumber.toString()); const nextSku = prefix + nextNumberStr; console.log(`Generated next SKU: ${nextSku}`); return nextSku; }
function initializeSku() { if (sessionStorage.getItem('skuPrefix') === null) { const startSku = prompt("Enter starting SKU pattern (e.g., PREFIX-001 or ITEM100):"); if (startSku) { if (!parseSkuPattern(startSku)) { sessionStorage.removeItem('skuPrefix'); sessionStorage.removeItem('skuPadding'); sessionStorage.removeItem('lastSkuNumber'); } } else { alert("SKU generation skipped..."); } } else { console.log("SKU pattern already initialized..."); } }
// --- End SKU Generation Logic ---

// --- Camera Start ---
async function startCamera() { console.log("startCamera function entered..."); try { const stream = await navigator.mediaDevices.getUserMedia(constraints); video.srcObject = stream; console.log("Camera stream started."); } catch (err) { console.error("Error accessing camera: ", err); alert("Could not access camera..."); } }

// --- Capture Button Logic ---
if (captureButton) {
    captureButton.addEventListener('click', async () => {
        console.log("Capture button clicked (Stage 1 - Cover/Primary).");
        if (!video.srcObject || !video.srcObject.active) { console.error("Video stream not active."); alert("Camera stream not available."); return; }
        if (!video.videoWidth || !video.videoHeight) { console.error("Video dimensions not available."); alert("Video not ready yet."); return; }

        // Capture Image 1
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageDataUrl1 = canvas.toDataURL('image/jpeg', 0.9);
        snapshotImg.src = imageDataUrl1; snapshotImg.style.display = 'block';
        console.log("Snapshot 1 taken.");

        let imageDataUrl2 = null;

        // Prompt for Second Image
        await new Promise(resolve => setTimeout(resolve, 100));
        if (confirm("Capture barcode/copyright page for more details? (Optional)")) {
            alert("Position camera for second shot (barcode/copyright) and click OK when ready.");
             try { // Capture Image 2
                  if (!video.srcObject || !video.srcObject.active) { throw new Error("Video stream stopped."); }
                  if (!video.videoWidth || !video.videoHeight) { throw new Error("Video dimensions lost."); }
                  console.log("Capturing second image...");
                  context.drawImage(video, 0, 0, canvas.width, canvas.height);
                  imageDataUrl2 = canvas.toDataURL('image/jpeg', 0.9);
                  console.log("Snapshot 2 taken.");
             } catch (capture2Error) { console.error("Error capturing second image:", capture2Error); alert("Failed to capture second image..."); imageDataUrl2 = null; }
        } else { console.log("Second image skipped by user."); }

        // Prepare Payload
        const payload = { image_data_1: imageDataUrl1, image_data_2: imageDataUrl2 };

        // Send Data to Backend
        console.log("Attempting to send image data (1 or 2 images) to deployed backend...");
        fetch('https://us-central1-aob-scanner.cloudfunctions.net/book-scanner-process-image', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        .then(response => { /* Keep existing response handling */ if (!response.ok) { return response.json().then(errData => { throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Unknown error'}`); }).catch(() => { throw new Error(`HTTP error! status: ${response.status}`); }); } return response.json(); })
        .then(data => {
             console.log('Data received from backend:', data);
             lastBackendResponseData = data;

             // --- Populate Form Fields & Apply Defaults ---
             if (data) {
                  // Generate and Set SKU AFTER fetch completes
                  const nextSku = generateNextSku();
                  if (nextSku !== null) { skuInput.value = nextSku; } else { skuInput.value = ''; }
                  console.log("SKU field populated.");

                  // Populate fields from Gemini results
                  const fields = data.parsed_fields || {};
                  titleInput.value = fields.title || ''; authorInput.value = fields.author || '';
                  isbnInput.value = fields.isbn || ''; publisherInput.value = fields.publisher || '';
                  releaseDateInput.value = fields.release_date || ''; languageInput.value = fields.language || 'English';
                  editionInput.value = fields.edition || '';
                  signedFlagCheckbox.checked = !!(fields.signature && fields.signature.toLowerCase().includes('sign'));
                  imageUrlInput.value = data.image_url || '';

                  // ** Apply Defaults / Reset relevant fields **
                  conditionSelect.value = '2'; // Default: Very Good
                  // ** Use Gemini price if available, otherwise default to 50 **
                  priceInput.value = fields.price || '50';
                  notesInput.value = "NO WRITING OR MARKING IN TEXT A CLEAN AND SOLID BOOK"; // Default Notes
                  qtyInput.value = '1'; // Reset quantity

                  // Clear fields likely needing manual input per item
                  conditionTextInput.value = '';
                  mediaInput.value = '';
                  const lastLocation = sessionStorage.getItem('lastLocation'); // Repopulate sticky location
                  locationInput.value = lastLocation || '';
                  costInput.value = '';
                  sourceInput.value = '';

                  console.log("Form fields populated/reset after capture.");

                  // Report backend errors
                  if (data.gcs_error) { console.error("GCS Error:", data.gcs_error); }
                  if (data.gemini_error) { console.error("Gemini Error:", data.gemini_error); }
             } else { console.error("Received no data object from backend."); }
             // --- End Populate/Reset Form Fields ---

             alert("Image(s) processed! Review details and click 'Add Book'.");
        })
        .catch(error => { /* Keep existing error handling */ console.error('Error sending image(s) to backend:', error); alert(`Failed to process image(s). Error: ${error.message}. Check browser console.`); });
    });
} else { console.error("Capture button (ID: captureButton) not found."); }
// --- End Capture Button Logic ---

// --- Function to update the displayed list of books ---
function renderSessionBooks() { /* Keep existing function */ if (!booksUl || !bookCountSpan) { console.error("Book list UL/Span not found."); return; } booksUl.innerHTML = ''; bookCountSpan.innerText = sessionBooks.length; if (sessionBooks.length === 0) { booksUl.innerHTML = '<li>No books added yet.</li>'; return; } sessionBooks.forEach((book, index) => { const listItem = document.createElement('li'); listItem.textContent = `[${index + 1}] ${book.sku}: ${book.title || 'N/A'} by ${book.author || 'N/A'} - Price: ${book.price || 'N/A'}`; booksUl.appendChild(listItem); }); }

// --- Add Book Button Logic ---
if (addBookButton) { addBookButton.addEventListener('click', () => { /* Keep existing function */ console.log("Add Book clicked."); const sku = skuInput.value.trim(); const title = titleInput.value.trim(); const author = authorInput.value.trim(); const isbn = isbnInput.value.trim(); const condition = conditionSelect.value; const condText = conditionTextInput.value.trim(); const price = priceInput.value.trim(); const qty = qtyInput.value; const notes = notesInput.value.trim(); const publisher = publisherInput.value.trim(); const releaseDate = releaseDateInput.value.trim(); const media = mediaInput.value.trim(); const location = locationInput.value.trim(); const cost = costInput.value.trim(); const source = sourceInput.value.trim(); const imageUrl = imageUrlInput.value.trim(); const isSigned = signedFlagCheckbox.checked; const edition = editionInput.value.trim(); const language = languageInput.value.trim(); const imageUrl2 = lastBackendResponseData ? lastBackendResponseData.image_url_2 : null; if (!sku) { alert("SKU required."); return; } if (!price) { alert("Price required."); return; } const qtyInt = parseInt(qty, 10); if (isNaN(qtyInt) || qtyInt < 1) { alert("Qty must be >= 1."); return; } if (!title && !isbn) { alert("Title or ISBN required."); return; } const bookData = { sku: sku, location: location, cost: cost ? parseFloat(cost) : null, source: source, isbn: isbn, title: title, author: author, publisher: publisher, release_date: releaseDate, image: imageUrl, image_2: imageUrl2 || "", media: media, price: price, condition: parseInt(condition, 10), notes: notes, qty: qtyInt, cond_text: condText, edition: edition, signature: isSigned ? "Signed" : "", language: language }; sessionBooks.push(bookData); console.log("Book added:", bookData); console.log("Session Array:", sessionBooks); if (location) { sessionStorage.setItem('lastLocation', location); console.log(`Saved last location: ${location}`); } renderSessionBooks(); alert(`Book '${bookData.title || bookData.sku}' added! (${sessionBooks.length} total)`); snapshotImg.src = ''; snapshotImg.style.display = 'none'; lastBackendResponseData = null; }); } else { console.error("Add Book button not found."); }
// --- End Add Book Button Logic ---

// --- Helper Button Logic ---
function setInputValue(elementId, value) { /* Keep existing function */ const inputElement = document.getElementById(elementId); if (inputElement) { inputElement.value = value; } else { console.error(`Element ID ${elementId} not found.`); } }
if (btn1stEd) { btn1stEd.addEventListener('click', () => setInputValue('edition', 'First Edition')); } else { console.warn("btn1stEd not found"); }
if (btnMediaPB) { btnMediaPB.addEventListener('click', () => setInputValue('media', 'Paperback')); } else { console.warn("btnMediaPB not found"); }
if (btnMediaHC) { btnMediaHC.addEventListener('click', () => setInputValue('media', 'Hardcover')); } else { console.warn("btnMediaHC not found"); }
if (btnMediaCD) { btnMediaCD.addEventListener('click', () => setInputValue('media', 'Audio CD')); } else { console.warn("btnMediaCD not found"); }
if (btnMediaDVD) { btnMediaDVD.addEventListener('click', () => setInputValue('media', 'DVD')); } else { console.warn("btnMediaDVD not found"); }
// --- End Helper Button Logic ---

// --- CSV Export Logic ---
function escapeCsvCell(value) { /* Keep existing function */ if (value == null) { return ''; } const stringValue = String(value); if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) { return `"${stringValue.replace(/"/g, '""')}"`; } return stringValue; }
function exportBooksToCsv() { /* Keep existing function */ if (sessionBooks.length === 0) { alert("No books added..."); return; } console.log("Generating CSV..."); const headers = ['sku', 'location', 'cost', 'source', 'isbn', 'title', 'author', 'publisher', 'release_date', 'image', 'image_2', 'media', 'price', 'condition', 'notes', 'qty', 'cond_text', 'edition', 'signature', 'language']; const headerRow = headers.map(escapeCsvCell).join(','); const dataRows = sessionBooks.map(book => { return headers.map(header => escapeCsvCell(book[header])).join(','); }); const csvContent = [headerRow, ...dataRows].join('\n'); const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement("a"); if (link.download !== undefined) { const url = URL.createObjectURL(blob); const timestamp = new Date().toISOString().replace(/[:\-T.]/g, '').substring(0, 14); link.setAttribute("href", url); link.setAttribute("download", `aob_export_${timestamp}.csv`); link.style.visibility = 'hidden'; document.body.appendChild(link); link.click(); document.body.removeChild(link); URL.revokeObjectURL(url); console.log("CSV download initiated."); } else { alert("CSV download not supported..."); } }
if (exportCsvButton) { exportCsvButton.addEventListener('click', exportBooksToCsv); }
else { console.error("Export CSV button not found."); }
// --- End CSV Export Logic ---

// --- Initialize Page ---
initializeSku();
renderSessionBooks();
console.log("--- Script loaded, attempting to start camera ---");
startCamera();
