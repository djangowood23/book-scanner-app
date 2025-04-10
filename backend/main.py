import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
from google.cloud import vision
from dotenv import load_dotenv
import re

logging.basicConfig(level=logging.INFO)
load_dotenv()

# --- Define CORS Headers ---
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', # Allow POST and OPTIONS for preflight
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600'
}

# --- Load Environment Variables ---
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME')
GOOGLE_CLOUD_PROJECT = os.environ.get('GOOGLE_CLOUD_PROJECT')

if not GCS_BUCKET_NAME:
    logging.warning("GCS_BUCKET_NAME environment variable not set.")

@functions_framework.http
def handle_process_image(request):
    """Handles OPTIONS and POST: Decodes, uploads, calls Vision (Text), parses text."""

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request")
        image_bytes = None
        image_url = None
        filename = None
        gcs_error = None
        extracted_text = None
        vision_error = None
        parsed_title = None
        parsed_author = None
        parsed_isbn = None

        # Prepare headers for all possible responses in POST path
        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Image
            try:
                data = request.get_json(silent=True)
                if not data or 'image_data' not in data:
                    logging.error("Missing or invalid JSON/image_data")
                    return ({'error': 'Missing or invalid image_data'}, 400, response_headers)

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

            # 2. Upload image to GCS
            if image_bytes and GCS_BUCKET_NAME:
                try:
                    storage_client = storage.Client()
                    bucket = storage_client.bucket(GCS_BUCKET_NAME)
                    filename = f"book_covers/{uuid.uuid4()}.jpg"
                    blob = bucket.blob(filename)
                    logging.info(f"Uploading image to gs://{GCS_BUCKET_NAME}/{filename}")
                    blob.upload_from_string(image_bytes, content_type='image/jpeg')
                    image_url = blob.public_url # Assumes public read access
                    logging.info(f"Image uploaded successfully: {image_url}")
                except Exception as err:
                    gcs_error = f"GCS Upload Error: {err}"
                    logging.exception(gcs_error)
            elif not GCS_BUCKET_NAME:
                 gcs_error = "GCS Bucket name not configured."
                 logging.error(gcs_error)


            # 3. Call Google Cloud Vision API (Text Detection Only)
            # Only proceed if GCS upload gave us a filename (or could use image_bytes)
            response = None
            if filename: # Using filename implies GCS upload was attempted/succeeded
                try:
                    logging.info(f"Calling Vision API for image gs://{GCS_BUCKET_NAME}/{filename}")
                    vision_client = vision.ImageAnnotatorClient()
                    image = vision.Image()
                    image.source.image_uri = f"gs://{GCS_BUCKET_NAME}/{filename}"
                    # Request only Text Detection
                    features = [vision.Feature(type_=vision.Feature.Type.TEXT_DETECTION)]
                    request_vision = vision.AnnotateImageRequest(image=image, features=features)
                    response = vision_client.annotate_image(request=request_vision)

                    if response.error.message:
                        vision_error = f'Vision API Error: {response.error.message}'
                        logging.error(vision_error)
                    elif response.full_text_annotation:
                        extracted_text = response.full_text_annotation.text
                        log_text_snippet = extracted_text[:100].replace('\n', ' ')
                        logging.info(f"Vision API extracted text (first 100 chars): {log_text_snippet}...")
                    else:
                        logging.info("Vision API found no text annotation.")
                        extracted_text = "" # Explicitly set empty

                except Exception as vision_api_error:
                    vision_error = f"Vision API Call Failed: {vision_api_error}"
                    logging.exception(vision_error)
            else:
                 vision_error = "Skipping Vision API call because GCS filename is missing."
                 logging.warning(vision_error)

            # 4. Basic Parsing Logic (using extracted_text)
            if extracted_text: # Check if text exists from Vision API
                lines = extracted_text.strip().split('\n')
                lines = [line.strip() for line in lines if line.strip()]
                logging.info(f"Attempting to parse {len(lines)} non-empty lines of text.")
                # ISBN Parsing
                isbn_pattern = re.compile(r'\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89]-?)?\d(?:-?\d){8,11}[\dX])\b', re.IGNORECASE)
                for line in lines:
                    match = isbn_pattern.search(line.replace(' ', ''))
                    if match:
                        parsed_isbn = re.sub(r'[- ]', '', match.group(1)); logging.info(f"Found potential ISBN from text: {parsed_isbn}"); break
                # Author Parsing
                author_line_index = -1
                for i, line in enumerate(lines):
                    line_lower = line.lower()
                    if line_lower.strip() == 'by' or ' by ' in line_lower:
                         if i + 1 < len(lines) and lines[i+1] != parsed_isbn: parsed_author = lines[i+1]; author_line_index = i+1; logging.info(f"Found potential Author from text: {parsed_author}"); break
                    elif i > 0 and lines[i-1].lower().endswith(' by'):
                         if lines[i] != parsed_isbn: parsed_author = lines[i]; author_line_index = i; logging.info(f"Found potential Author (alt) from text: {parsed_author}"); break
                # Title Parsing (longest line not author/isbn)
                longest_line = ""
                for i, line in enumerate(lines):
                    if i != author_line_index and len(line) > len(longest_line):
                         # Check if parsed_isbn is None before using 'in' (TypeError fix)
                         if len(line) > 3 and (parsed_isbn is None or parsed_isbn not in line): longest_line = line
                if longest_line: parsed_title = longest_line; logging.info(f"Found potential Title from text: {parsed_title}")

            elif vision_error is None: # Log only if no text and no prior vision error
                logging.info("No extracted text to parse.")
            # --- End Parsing Logic ---

            # 5. Prepare final response data
            response_data = {
                "message": "Image processed successfully.",
                "image_url": image_url, # This is the captured image URL from GCS
                "gcs_error": gcs_error,
                "vision_error": vision_error,
                "extracted_text_raw": extracted_text, # Text from OCR
                "parsed_fields": { # Basic parsed values
                    "title": parsed_title,
                    "author": parsed_author,
                    "isbn": parsed_isbn,
                }
            }
            logging.info("Sending final response")
            # Return tuple: (data, status_code, headers) including manual CORS header
            return (response_data, 200, response_headers)

        # Catch-all for unexpected errors during POST processing
        except Exception as e:
            logging.exception(f"Unexpected error processing POST request: {e}")
            return ({'error': 'An unexpected internal error occurred'}, 500, response_headers) # Add CORS header

    # --- Handle other methods ---
    else:
        logging.warning(f"Received unhandled method: {request.method}")
        response_data = {'error': f"Method {request.method} not allowed."}
        return (response_data, 405, response_headers) # Add CORS header
