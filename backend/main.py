import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
import google.generativeai as genai # Import Gemini library
import json # For parsing Gemini's JSON response
from dotenv import load_dotenv
# Keep requests for potential future use
import requests

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
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

# --- Configure Gemini ---
gemini_configured = False
if not GEMINI_API_KEY:
    logging.warning("GEMINI_API_KEY environment variable not set.")
else:
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        gemini_configured = True
        logging.info("Gemini API configured successfully.")
    except Exception as config_err:
         logging.error(f"Failed to configure Gemini API: {config_err}")

if not GCS_BUCKET_NAME:
    logging.warning("GCS_BUCKET_NAME environment variable not set.")

@functions_framework.http
def handle_process_image(request):
    """Handles OPTIONS and POST: Decodes, uploads to GCS, calls Gemini API."""

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request")
        scan_type = 'cover'
        image_bytes = None
        image_url = None # URL of image uploaded to GCS
        stock_image_url = None # URL from external lookup
        filename = None
        gcs_error = None
        gemini_error = None
        parsed_fields_dict = None # Parsed data from Gemini
        lookup_error = None # Placeholder for lookup error

        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Image & Get Scan Type
            try:
                data = request.get_json(silent=True)
                if not data or 'image_data' not in data:
                    logging.error("Missing or invalid JSON/image_data")
                    return ({'error': 'Missing or invalid image_data'}, 400, response_headers)
                scan_type = data.get('scan_type', 'cover') # Get scan type
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

            # 2. Upload image to GCS
            if image_bytes and GCS_BUCKET_NAME:
                try:
                    storage_client = storage.Client()
                    bucket = storage_client.bucket(GCS_BUCKET_NAME)
                    filename = f"book_covers/{uuid.uuid4()}.jpg"
                    blob = bucket.blob(filename)
                    logging.info(f"Uploading image to gs://{GCS_BUCKET_NAME}/{filename}")
                    blob.upload_from_string(image_bytes, content_type='image/jpeg')
                    image_url = blob.public_url # URL of the actual uploaded image
                    logging.info(f"Image uploaded successfully: {image_url}")
                except Exception as err:
                    gcs_error = f"GCS Upload Error: {err}"
                    logging.exception(gcs_error)
            elif not GCS_BUCKET_NAME:
                 gcs_error = "GCS Bucket name not configured."
                 logging.error(gcs_error)

            # 3. Call Gemini Vision API
            if image_bytes and gemini_configured:
                try:
                    logging.info("Calling Gemini API...")
                    model = genai.GenerativeModel('gemini-1.5-flash-latest')
                    prompt = """Analyze the provided image, which is either a book cover or contains a barcode. 
                    Identify the following bibliographic details if available: Title, Author(s), ISBN (10 or 13), 
                    Publisher, Publication Year (YYYY if possible), Language, Edition information, and whether 
                    there's text indicating it's Signed. 
                    Return ONLY a single valid JSON object containing these exact keys: 
                    "title", "author", "isbn", "publisher", "release_date", "language", "edition", "signature". 
                    If a field cannot be determined from the image, use null as its value. 
                    For "author", if multiple authors, join them with commas. For "signature", return "Signed" 
                    if evidence found, otherwise null. Ensure the output is ONLY the JSON object.
                    """
                    image_part = { "mime_type": "image/jpeg", "data": image_bytes }
                    response = model.generate_content([prompt, image_part])
                    logging.info("Gemini response received.")

                    try:
                        response_text = response.text.strip()
                        json_start = response_text.find('{')
                        json_end = response_text.rfind('}')
                        if json_start != -1 and json_end != -1 and json_end > json_start:
                             json_text = response_text[json_start:json_end+1]
                             parsed_fields_dict = json.loads(json_text)
                             logging.info("Successfully parsed JSON response from Gemini.")
                             logging.info(f"Gemini Parsed Fields: {parsed_fields_dict}")
                        else:
                             raise ValueError("No valid JSON object found in response text.")
                    except (json.JSONDecodeError, AttributeError, ValueError) as json_err:
                        gemini_error = f"Failed to parse JSON from Gemini response: {json_err} | Response text snippet: {response.text[:500]}"
                        logging.error(gemini_error)
                    except Exception as inner_err:
                         gemini_error = f"Error processing Gemini response text: {inner_err}"
                         logging.exception(gemini_error)

                    if hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason:
                        block_reason = f"Gemini request blocked due to: {response.prompt_feedback.block_reason}"
                        logging.error(block_reason)
                        gemini_error = f"{gemini_error or ''} | {block_reason}".strip(" | ")
                        parsed_fields_dict = None

                except Exception as gemini_api_error:
                    gemini_error = f"Gemini API Call Failed: {gemini_api_error}"
                    logging.exception(gemini_api_error)
                    parsed_fields_dict = None
            elif not gemini_configured:
                gemini_error = "Gemini API Key not configured or configuration failed."
                logging.error(gemini_error)
            else:
                 gemini_error = "Skipping Gemini API call because image decoding failed."
                 logging.warning(gemini_error)

            # 4. Prepare final response data
            final_parsed_fields = { # Ensure all keys exist, default to None
                "title": None, "author": None, "isbn": None, "publisher": None,
                "release_date": None, "language": None, "edition": None, "signature": None
            }
            if isinstance(parsed_fields_dict, dict):
                 # Update with fields actually found by Gemini
                 for key in final_parsed_fields.keys():
                     final_parsed_fields[key] = parsed_fields_dict.get(key)

            # Use stock URL if found and preferred (Option B), otherwise use captured URL
            # Currently no logic sets stock_image_url, so defaults to captured image_url
            final_image_url_for_aob = stock_image_url if stock_image_url else image_url

            response_data = {
                "message": "Image processed using Gemini.",
                "image_url": final_image_url_for_aob,
                "captured_image_url": image_url,
                "stock_image_url": stock_image_url, # Include if lookup provides it
                "gcs_error": gcs_error,
                "gemini_error": gemini_error,
                "lookup_error": lookup_error, # Placeholder for future lookup
                "parsed_fields": final_parsed_fields
                # Removed extracted_text_raw
            }
            logging.info("Sending final response")
            return (response_data, 200, response_headers)

        # Catch-all for unexpected errors during POST processing
        except Exception as e:
            logging.exception(f"Unexpected error processing POST request: {e}")
            return ({'error': 'An unexpected internal error occurred'}, 500, response_headers)

    # --- Handle other methods ---
    else:
        logging.warning(f"Received unhandled method: {request.method}")
        response_data = {'error': f"Method {request.method} not allowed."}
        return (response_data, 405, response_headers) # Add CORS header
