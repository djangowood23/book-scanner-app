import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
from google.cloud import vision
from dotenv import load_dotenv
import re
import requests # Added for future API lookups

logging.basicConfig(level=logging.INFO)
load_dotenv()

# --- Define CORS Headers ---
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600'
}

# --- Load Environment Variables ---
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME')
GOOGLE_CLOUD_PROJECT = os.environ.get('GOOGLE_CLOUD_PROJECT')
# GOOGLE_API_KEY = os.environ.get('GOOGLE_API_KEY') # For Google Books API later

if not GCS_BUCKET_NAME:
    logging.warning("GCS_BUCKET_NAME environment variable not set.")

@functions_framework.http
def handle_process_image(request):
    """Handles OPTIONS and POST requests. Chooses barcode lookup or OCR parsing."""

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request")
        scan_type = 'cover' # Default
        image_bytes = None
        image_url = None # URL of image uploaded to GCS
        stock_image_url = None # URL from external lookup (if barcode scan)
        filename = None
        gcs_error = None
        extracted_text = None
        vision_error = None
        parsed_title = None
        parsed_author = None
        parsed_isbn = None
        isbn_from_barcode = None
        barcode_format = None
        lookup_error = None
        lookup_successful = False # Flag to indicate if barcode lookup provided data

        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Image & Get Scan Type
            try:
                data = request.get_json(silent=True)
                if not data or 'image_data' not in data:
                    logging.error("Missing or invalid JSON/image_data")
                    return ({'error': 'Missing or invalid image_data'}, 400, response_headers)

                scan_type = data.get('scan_type', 'cover') # Get scan type from request
                logging.info(f"Received scan_type: {scan_type}")

                image_data_url = data['image_data']
                if ';base64,' not in image_data_url:
                     logging.error(f"Invalid image data format")
                     return ({'error': 'Invalid image data format'}, 400, response_headers)

                header, encoded = image_data_url.split(",", 1)
                image_bytes = base64.b64decode(encoded)
                logging.info(f"Decoded image size: {len(image_bytes)} bytes")

            except Exception as decode_error:
                logging.error(f"Base64 Decode Error: {decode_error}")
                return ({'error': 'Failed to decode base64 image data'}, 400, response_headers)

            # 2. Upload image to GCS (always upload the captured image)
            if image_bytes and GCS_BUCKET_NAME:
                try:
                    storage_client = storage.Client()
                    bucket = storage_client.bucket(GCS_BUCKET_NAME)
                    # Add scan_type to filename maybe? or keep random? Keep random for now.
                    filename = f"book_covers/{uuid.uuid4()}.jpg"
                    blob = bucket.blob(filename)
                    logging.info(f"Uploading image to gs://{GCS_BUCKET_NAME}/{filename}")
                    blob.upload_from_string(image_bytes, content_type='image/jpeg')
                    image_url = blob.public_url # URL of the *captured* image
                    logging.info(f"Image uploaded successfully: {image_url}")
                except Exception as err:
                    gcs_error = f"GCS Upload Error: {err}"
                    logging.exception(gcs_error)
                    # Continue, image_url will be None, filename will be None
            elif not GCS_BUCKET_NAME:
                 gcs_error = "GCS Bucket name not configured."
                 logging.error(gcs_error)


            # 3. Call Google Cloud Vision API (Requesting Text AND Barcode)
            # Only proceed if we have the image bytes to analyze
            if image_bytes:
                try:
                    logging.info(f"Calling Vision API for image...")
                    vision_client = vision.ImageAnnotatorClient()
                    # Use image bytes directly for Vision API
                    vision_image = vision.Image(content=image_bytes)

                    # Specify BOTH text and barcode detection features
                    features = [
                        vision.Feature(type_=vision.Feature.Type.TEXT_DETECTION),
                        vision.Feature(type_=vision.Feature.Type.BARCODE_DETECTION)
                    ]
                    request_vision = vision.AnnotateImageRequest(image=vision_image, features=features)
                    response = vision_client.annotate_image(request=request_vision)

                    if response.error.message:
                        vision_error = f'Vision API Error: {response.error.message}'
                        logging.error(vision_error)
                    else:
                        # Check for barcodes FIRST
                        barcodes = response.barcode_annotations
                        if barcodes:
                             for barcode in barcodes:
                                 # Prioritize EAN13 (ISBN) or UPC
                                 if barcode.format in [vision.Barcode.Format.EAN_13, vision.Barcode.Format.UPC_A]:
                                     isbn_from_barcode = barcode.display_data # Use display_data
                                     barcode_format = barcode.format.name
                                     logging.info(f"Vision API found barcode ({barcode_format}): {isbn_from_barcode}")
                                     break # Use the first valid one

                        # Check for text (might exist even if barcode found)
                        if response.full_text_annotation:
                            extracted_text = response.full_text_annotation.text
                            log_text_snippet = extracted_text[:100].replace('\n', ' ')
                            logging.info(f"Vision API extracted text (first 100 chars): {log_text_snippet}...")
                        else:
                            logging.info("Vision API found no text annotation.")
                            extracted_text = "" # Set to empty if no text, even if barcode found

                except Exception as vision_api_error:
                    vision_error = f"Vision API Call Failed: {vision_api_error}"
                    logging.exception(vision_error)
            else:
                vision_error = "Skipping Vision API call because image decoding failed."
                logging.warning(vision_error)


            # 4. Conditional Processing: Barcode Lookup OR Text Parsing
            # Only proceed if Vision API call itself didn't fail hard
            if vision_error is None:
                # Prioritize barcode lookup if requested and barcode found
                if scan_type == 'barcode' and isbn_from_barcode:
                    logging.info(f"Attempting external lookup for ISBN/UPC: {isbn_from_barcode}")
                    parsed_isbn = isbn_from_barcode # Use the accurate one
                    # --- TODO: Implement lookup_book_by_isbn(isbn_from_barcode) ---
                    # This function should call Google Books API etc.
                    # and return a dict like {'title': ..., 'author': ..., 'publisher': ..., 'year': ..., 'language': ..., 'stock_image_url': ...} or None
                    lookup_result = None # Placeholder for now
                    # --- End TODO ---

                    if lookup_result:
                        logging.info(f"External lookup successful for {isbn_from_barcode}")
                        parsed_title = lookup_result.get('title')
                        # Google Books often returns authors as a list
                        authors = lookup_result.get('authors')
                        if authors and isinstance(authors, list):
                            parsed_author = ", ".join(authors)
                        elif authors: # Handle if it's just a string
                             parsed_author = str(authors)
                        else:
                             parsed_author = None
                        # Extract other fields if available in lookup_result
                        parsed_publisher = lookup_result.get('publisher') # Need to add this variable
                        parsed_year = lookup_result.get('year') # Need to add this variable
                        parsed_language = lookup_result.get('language') # Need to add this variable
                        stock_image_url = lookup_result.get('stock_image_url')
                        lookup_successful = True
                    else:
                        lookup_error = f"External lookup failed or not implemented for {isbn_from_barcode}."
                        logging.warning(lookup_error)
                        # Fallback to using extracted text IF available? Or just return barcode?
                        # Let's just return the barcode for now if lookup fails.

                # Fallback to text parsing if barcode lookup wasn't requested,
                # didn't find a barcode, or failed
                if not lookup_successful:
                    logging.info("Proceeding with OCR text parsing.")
                    if extracted_text: # Check if text extraction was successful
                        lines = extracted_text.strip().split('\n')
                        lines = [line.strip() for line in lines if line.strip()]
                        logging.info(f"Attempting to parse {len(lines)} non-empty lines of text.")
                        # ISBN Parsing from text (if not found from barcode)
                        if not parsed_isbn: # Only parse if barcode didn't provide it
                             isbn_pattern = re.compile(r'\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89]-?)?\d(?:-?\d){8,11}[\dX])\b', re.IGNORECASE)
                             for line in lines:
                                 match = isbn_pattern.search(line.replace(' ', ''))
                                 if match:
                                     parsed_isbn = re.sub(r'[- ]', '', match.group(1))
                                     logging.info(f"Found potential ISBN from text: {parsed_isbn}")
                                     break
                        # Author Parsing from text
                        author_line_index = -1
                        # (Keep existing Author parsing logic)
                        for i, line in enumerate(lines):
                            line_lower = line.lower()
                            if line_lower.strip() == 'by' or ' by ' in line_lower:
                                if i + 1 < len(lines) and lines[i+1] != parsed_isbn:
                                    parsed_author = lines[i+1]
                                    author_line_index = i+1
                                    logging.info(f"Found potential Author from text: {parsed_author}")
                                    break
                            elif i > 0 and lines[i-1].lower().endswith(' by'):
                                if lines[i] != parsed_isbn:
                                    parsed_author = lines[i]
                                    author_line_index = i
                                    logging.info(f"Found potential Author (alt) from text: {parsed_author}")
                                    break
                        # Title Parsing from text
                        longest_line = ""
                        for i, line in enumerate(lines):
                            if i != author_line_index and len(line) > len(longest_line):
                                if len(line) > 3 and (parsed_isbn is None or parsed_isbn not in line):
                                     longest_line = line
                        if longest_line:
                            parsed_title = longest_line
                            logging.info(f"Found potential Title from text: {parsed_title}")

                    elif vision_error is None: # Only log if no text and no prior vision error
                        logging.info("No OCR text found to parse.")
                # --- End Text Parsing Block ---

            # 5. Prepare final response data
            # Decide which image URL to send back based on user preference (Option B)
            final_image_url_for_aob = stock_image_url if stock_image_url else image_url

            response_data = {
                "message": "Image processed.",
                "scan_type_received": scan_type,
                "image_url": final_image_url_for_aob, # Potentially stock image URL
                "captured_image_url": image_url, # Always include the GCS URL of the photo taken
                "stock_image_url": stock_image_url, # Explicitly include stock URL if found
                "gcs_error": gcs_error,
                "vision_error": vision_error, # Covers general Vision API errors
                "lookup_error": lookup_error, # Specific error from ISBN lookup if it occurs
                "extracted_text_raw": extracted_text, # Include raw text if OCR was run
                "parsed_fields": {
                    "title": parsed_title, # From lookup or parse
                    "author": parsed_author, # From lookup or parse
                    "isbn": parsed_isbn, # From barcode OR parse
                    # Add other fields from lookup later if implemented
                    "publisher": None, # Placeholder
                    "release_date": None, # Placeholder
                    "language": None, # Placeholder
                    "edition": None # Placeholder - manual entry for now
                    # Add edition, language etc. if parsed/looked up later
                }
            }
            logging.info("Sending final response")
            # Return tuple: (data, status_code, headers) including manual CORS header
            return (response_data, 200, response_headers)

        # Catch-all for unexpected errors during POST processing
        except Exception as e:
            logging.exception(f"Unexpected error processing POST request: {e}")
            return ({'error': 'An unexpected internal error occurred'}, 500, response_headers)

    # --- Handle other methods ---
    else:
        # ... (Keep existing handling for other methods) ...
         logging.warning(f"Received unhandled method: {request.method}")
         response_data = {'error': f"Method {request.method} not allowed."}
         response_headers['Content-Type'] = 'application/json'
         return (response_data, 405, response_headers) # Add CORS header
