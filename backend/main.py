import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
import google.generativeai as genai
import json
from dotenv import load_dotenv
# Removed requests and re as they are not needed in this simplified version

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


# Removed lookup_book_by_isbn function definition for this simplified version


@functions_framework.http
def handle_process_image(request):
    """Handles OPTIONS/POST: Decodes single image, uploads, calls Gemini."""

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request (V2-Simple)")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request (V2-Simple)")
        # Initialize variables
        image_bytes = None
        image_url = None
        filename = None
        gcs_error = None
        gemini_error = None
        parsed_fields_dict = None

        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Image (Only image_data_1)
            try:
                data = request.get_json(silent=True)
                if not data or 'image_data_1' not in data: # Check only for image_data_1
                    logging.error("Missing or invalid JSON/image_data_1")
                    return ({'error': 'Missing image_data_1'}, 400, response_headers)

                image_data_url_1 = data['image_data_1']
                if ';base64,' not in image_data_url_1:
                     logging.error(f"Invalid image data format")
                     return ({'error': 'Invalid image data format'}, 400, response_headers)
                header1, encoded1 = image_data_url_1.split(",", 1)
                image_bytes = base64.b64decode(encoded1) # Store as image_bytes
                logging.info(f"Decoded image size: {len(image_bytes)} bytes")

            except Exception as decode_error:
                logging.error(f"Base64 Decode Error: {decode_error}")
                return ({'error': 'Failed to decode base64 image data'}, 400, response_headers)

            # 2. Upload single image to GCS
            if image_bytes and GCS_BUCKET_NAME:
                try:
                    storage_client = storage.Client()
                    bucket = storage_client.bucket(GCS_BUCKET_NAME)
                    # Use simpler filename now
                    filename = f"book_covers/{uuid.uuid4()}.jpg"
                    blob = bucket.blob(filename)
                    logging.info(f"Uploading image to gs://{GCS_BUCKET_NAME}/{filename}")
                    blob.upload_from_string(image_bytes, content_type='image/jpeg')
                    image_url = blob.public_url # URL of the uploaded image
                    logging.info(f"Image uploaded successfully: {image_url}")
                except Exception as err:
                    gcs_error = f"GCS Upload Error: {err}"
                    logging.exception(gcs_error)
                    # If upload fails, image_url remains None, but we still try Gemini with bytes
            elif not GCS_BUCKET_NAME:
                 gcs_error = "GCS Bucket name not configured."
                 logging.error(gcs_error)


            # 3. Call Gemini Vision API with single image
            if image_bytes and gemini_configured:
                try:
                    logging.info("Calling Gemini API (single image)...")
                    model = genai.GenerativeModel('gemini-1.5-flash-latest')

                    # Refined prompt for single image, requesting price estimate, stricter on null
                    prompt = """You are an expert librarian and rare book cataloger analyzing the provided image of a book cover, barcode area, or copyright page. 
                    Extract the following bibliographic details as accurately as possible and return ONLY a single valid JSON object containing these exact keys: 
                    "title", "author", "isbn", "publisher", "release_date", "language", "edition", "signature", "volume", "price".

                    Specific instructions:
                    - Look carefully for ISBN (10 or 13 digits), possibly prefixed "ISBN". Return numbers only, no hyphens/spaces if possible.
                    - For release_date, look for a copyright year (e.g., ©2005) or publication date. Return just the year (YYYY) if possible.
                    - For signature, return "Signed" only if clear textual evidence like "Signed by author" is visible.
                    - For price, provide a single estimated reference price as a numeric string (e.g., "15.00" or "20") based on your general knowledge of the book identified. Acknowledge this is only an estimate based on training data.
                    - For all other fields (title, author, publisher, language, edition, volume), extract if clearly identifiable.
                    - If any field cannot be determined, you MUST return null as its value. Do NOT return text like 'Not visible in image' or 'N/A', use only JSON null.
                    - Ensure the entire output is ONLY the JSON object, with no surrounding text or markdown formatting like ```json.
                    """

                    image_part = {"mime_type": "image/jpeg", "data": image_bytes}
                    content_parts = [prompt, image_part] # Only prompt and one image

                    response = model.generate_content(content_parts)
                    logging.info("Gemini response received.")

                    # Attempt to parse the JSON response
                    try:
                        response_text = response.text.strip()
                        json_start = response_text.find('{'); json_end = response_text.rfind('}')
                        if json_start != -1 and json_end != -1 and json_end > json_start:
                             json_text = response_text[json_start:json_end+1]
                             parsed_fields_dict = json.loads(json_text)
                             logging.info("Successfully parsed JSON response from Gemini.")
                             logging.info(f"Gemini Parsed Fields: {parsed_fields_dict}")
                        else: raise ValueError(f"No valid JSON object found: {response_text[:500]}")
                    except Exception as json_err:
                        gemini_error = f"Failed to parse JSON from Gemini: {json_err} | Response: {getattr(response, 'text', 'N/A')[:500]}"
                        logging.error(gemini_error); parsed_fields_dict = None
                    if hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason:
                        block_reason = f"Gemini blocked: {response.prompt_feedback.block_reason}"; logging.error(block_reason)
                        gemini_error = f"{gemini_error or ''} | {block_reason}".strip(" | "); parsed_fields_dict = None

                except Exception as gemini_api_error:
                    gemini_error = f"Gemini API Call Failed: {gemini_api_error}"
                    logging.exception(gemini_error); parsed_fields_dict = None

            elif not gemini_configured: gemini_error = "Gemini API Key not configured."; logging.error(gemini_error)
            else: gemini_error = "Skipping Gemini: Image bytes missing."; logging.warning(gemini_error)


            # 4. Prepare final response data
            final_parsed_fields = { # Define all expected keys from the prompt
                "title": None, "author": None, "isbn": None, "publisher": None,
                "release_date": None, "language": None, "edition": None, "signature": None,
                "volume": None, "price": None
            }
            if isinstance(parsed_fields_dict, dict):
                 for key in final_parsed_fields.keys():
                     final_parsed_fields[key] = parsed_fields_dict.get(key) # Populate from Gemini result

            response_data = {
                "message": "Image processed using Gemini (single image).",
                "image_url": image_url, # GCS URL of the captured image
                "gcs_error": gcs_error,
                "gemini_error": gemini_error,
                "parsed_fields": final_parsed_fields
                # Removed fields related to image_2, lookup_error, stock_image_url
            }
            logging.info("Sending final response")
            return (response_data, 200, response_headers) # Return data, status, CORS headers

        # Catch-all for unexpected errors
        except Exception as e:
            logging.exception(f"Unexpected error processing POST request: {e}")
            return ({'error': 'An unexpected internal error occurred'}, 500, response_headers)

    # --- Handle other methods ---
    else:
        logging.warning(f"Received unhandled method: {request.method}")
        response_data = {'error': f"Method {request.method} not allowed."}
        return (response_data, 405, response_headers)
