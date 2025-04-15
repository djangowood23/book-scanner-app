import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
import google.generativeai as genai
import json
from dotenv import load_dotenv
# Keep requests for potential future use (e.g., fallback lookup)
import requests

logging.basicConfig(level=logging.INFO)
load_dotenv() # Load .env file for local testing

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
    """Handles OPTIONS/POST: Decodes image(s), uploads, calls Gemini."""

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request (V2 multi-image)")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request (V2 multi-image)")
        image_bytes_1 = None
        image_bytes_2 = None
        image_url_1 = None # URL of primary image (e.g., cover)
        image_url_2 = None # URL of secondary image (e.g., details/barcode)
        filename_1 = None
        filename_2 = None
        gcs_error_1 = None
        gcs_error_2 = None
        gemini_error = None
        parsed_fields_dict = None # Parsed data from Gemini

        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Images from Payload
            try:
                data = request.get_json(silent=True)
                # Expect image_data_1, image_data_2 (optional)
                if not data or 'image_data_1' not in data:
                    logging.error("Missing or invalid JSON/image_data_1")
                    return ({'error': 'Missing image_data_1'}, 400, response_headers)

                # Decode Image 1 (Mandatory)
                image_data_url_1 = data['image_data_1']
                if ';base64,' not in image_data_url_1:
                     logging.error(f"Invalid image data format for image 1")
                     return ({'error': 'Invalid image data format for image 1'}, 400, response_headers)
                header1, encoded1 = image_data_url_1.split(",", 1)
                image_bytes_1 = base64.b64decode(encoded1)
                logging.info(f"Decoded image 1 size: {len(image_bytes_1)} bytes")

                # Decode Image 2 (Optional)
                image_data_url_2 = data.get('image_data_2') # Use .get()
                if image_data_url_2 and isinstance(image_data_url_2, str) and ';base64,' in image_data_url_2:
                    try:
                        header2, encoded2 = image_data_url_2.split(",", 1)
                        image_bytes_2 = base64.b64decode(encoded2)
                        logging.info(f"Decoded image 2 size: {len(image_bytes_2)} bytes")
                    except Exception as decode_error_2:
                        logging.error(f"Base64 Decode Error for image 2: {decode_error_2}")
                        image_bytes_2 = None # Proceed without image 2
                else:
                    logging.info("No valid image_data_2 provided.")
                    image_bytes_2 = None

            except Exception as decode_error_1:
                logging.error(f"Base64 Decode Error for image 1: {decode_error_1}")
                return ({'error': 'Failed to decode base64 image_data_1'}, 400, response_headers)

            # 2. Upload images to GCS
            if image_bytes_1 and GCS_BUCKET_NAME:
                try:
                    storage_client = storage.Client()
                    bucket = storage_client.bucket(GCS_BUCKET_NAME)

                    # Upload Image 1
                    filename_1 = f"book_covers/{uuid.uuid4()}_img1.jpg"
                    blob1 = bucket.blob(filename_1)
                    logging.info(f"Uploading image 1 to gs://{GCS_BUCKET_NAME}/{filename_1}")
                    blob1.upload_from_string(image_bytes_1, content_type='image/jpeg')
                    image_url_1 = blob1.public_url # Primary image URL
                    logging.info(f"Image 1 uploaded successfully: {image_url_1}")

                    # Upload Image 2 if it exists
                    if image_bytes_2:
                        filename_2 = f"book_covers/{uuid.uuid4()}_img2.jpg"
                        blob2 = bucket.blob(filename_2)
                        logging.info(f"Uploading image 2 to gs://{GCS_BUCKET_NAME}/{filename_2}")
                        blob2.upload_from_string(image_bytes_2, content_type='image/jpeg')
                        image_url_2 = blob2.public_url # URL for second image
                        logging.info(f"Image 2 uploaded successfully: {image_url_2}")

                except Exception as err:
                    gcs_error_1 = f"GCS Upload Error: {err}" # General GCS error
                    logging.exception(gcs_error_1)
                    # Reset URLs if upload failed partway
                    if not image_url_1: filename_1 = None
                    if not image_url_2: filename_2 = None
            elif not GCS_BUCKET_NAME:
                 gcs_error_1 = "GCS Bucket name not configured."
                 logging.error(gcs_error_1)


            # 3. Call Gemini Vision API with one or two images
            if image_bytes_1 and gemini_configured:
                try:
                    logging.info("Calling Gemini API with available images...")
                    model = genai.GenerativeModel('gemini-1.5-flash-latest')

                    # Updated prompt for potentially two images
                    prompt = """Analyze the provided image(s). Image 1 is the primary view (likely book cover). 
                    Image 2, if provided, is a secondary view (likely barcode area or copyright/details page).
                    Identify the following bibliographic details, prioritizing Image 2 for ISBN, Publisher, and Release Date (use YYYY format if possible) if available and clear, 
                    and Image 1 for Title and Author. Return ONLY a single valid JSON object containing these exact keys: 
                    "title", "author", "isbn", "publisher", "release_date", "language", "edition", "signature". 
                    If a field cannot be determined from the images, use null as its value. 
                    For "author", if multiple authors, join them with commas. For "signature", return "Signed" 
                    if explicit textual evidence like 'signed by' is found, otherwise null. 
                    Ensure the output is ONLY the JSON object with no surrounding text or markdown backticks.
                    """

                    # Prepare image parts
                    image_part_1 = {"mime_type": "image/jpeg", "data": image_bytes_1}
                    content_parts = [prompt, image_part_1]

                    if image_bytes_2:
                        image_part_2 = {"mime_type": "image/jpeg", "data": image_bytes_2}
                        content_parts.append(image_part_2)
                        logging.info(f"Sending {len(content_parts)-1} images to Gemini.")
                    else:
                        logging.info(f"Sending {len(content_parts)-1} image to Gemini.")


                    response = model.generate_content(content_parts)
                    logging.info("Gemini response received.")

                    # Attempt to parse the JSON response
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
                             # If Gemini didn't return JSON, log the text and set error
                             gemini_error = f"Gemini did not return valid JSON. Response text: {response_text[:500]}"
                             logging.error(gemini_error)
                             parsed_fields_dict = None # Ensure null if no JSON

                    except (json.JSONDecodeError, AttributeError, ValueError) as json_err:
                        gemini_error = f"Failed to parse JSON from Gemini response: {json_err} | Response text snippet: {getattr(response, 'text', 'N/A')[:500]}"
                        logging.error(gemini_error)
                        parsed_fields_dict = None
                    except Exception as inner_err:
                         gemini_error = f"Error processing Gemini response text: {inner_err}"
                         logging.exception(gemini_error)
                         parsed_fields_dict = None

                    # Check for safety/block reasons after trying to parse
                    if hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason:
                        block_reason = f"Gemini request blocked due to: {response.prompt_feedback.block_reason}"
                        logging.error(block_reason)
                        gemini_error = f"{gemini_error or ''} | {block_reason}".strip(" | ")
                        parsed_fields_dict = None # Ensure null if blocked

                except Exception as gemini_api_error:
                    gemini_error = f"Gemini API Call Failed: {gemini_api_error}"
                    logging.exception(gemini_error)
                    parsed_fields_dict = None

            elif not gemini_configured:
                gemini_error = "Gemini API Key not configured or config failed."
                logging.error(gemini_error)
            else:
                 gemini_error = "Skipping Gemini: Image 1 decoding failed."
                 logging.warning(gemini_error)

            # 4. Prepare final response data
            final_parsed_fields = { # Default structure
                "title": None, "author": None, "isbn": None, "publisher": None,
                "release_date": None, "language": None, "edition": None, "signature": None
            }
            if isinstance(parsed_fields_dict, dict):
                 # Update with fields actually found by Gemini
                 for key in final_parsed_fields.keys():
                     final_parsed_fields[key] = parsed_fields_dict.get(key) # Use .get() default is None

            # Decide on primary image URL (use image_url_1 from cover/first shot)
            # Stock image lookup logic would go here if implemented
            final_image_url_for_aob = image_url_1

            response_data = {
                "message": "Image(s) processed using Gemini.",
                "image_url": final_image_url_for_aob, # Primary image URL for form
                "image_url_2": image_url_2, # Secondary image URL (if taken)
                "gcs_error": gcs_error_1,
                "gemini_error": gemini_error,
                "parsed_fields": final_parsed_fields
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
