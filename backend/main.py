import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage # Only need storage client now
from dotenv import load_dotenv
# Removed genai, json, requests, re

logging.basicConfig(level=logging.INFO)
load_dotenv() # Load .env file for local testing

# --- Define CORS Headers ---
# Still needed for requests from the frontend
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '3600'
}

# --- Load Environment Variables ---
# Only need GCS bucket name now for this function's core logic
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME')
# GOOGLE_CLOUD_PROJECT = os.environ.get('GOOGLE_CLOUD_PROJECT') # Not explicitly used, but good practice
# GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY') # No longer needed here
# GOOGLE_BOOKS_API_KEY = os.environ.get('GOOGLE_BOOKS_API_KEY') # No longer needed here

if not GCS_BUCKET_NAME:
    logging.warning("GCS_BUCKET_NAME environment variable not set.")

# --- Removed Gemini Configuration ---
# --- Removed Google Books API Lookup Function ---

@functions_framework.http
def handle_process_image(request):
    """
    Handles OPTIONS/POST: Decodes image(s) from frontend file upload,
    uploads them to GCS, and returns the GCS URLs.
    Does NOT call any AI models.
    """

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request (Upload Only)")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request (Upload Only)")
        # Initialize variables
        image_bytes_1 = None
        image_bytes_2 = None
        image_url_1 = None # URL of primary image
        image_url_2 = None # URL of secondary image
        filename_1 = None
        filename_2 = None
        gcs_error = None

        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Images from Payload
            try:
                data = request.get_json(silent=True)
                # Expect image_data_1, image_data_2 (optional) from file upload
                if not data or 'image_data_1' not in data:
                    logging.error("Missing or invalid JSON/image_data_1")
                    return ({'error': 'Missing image_data_1'}, 400, response_headers)

                # Decode Image 1
                image_data_url_1 = data['image_data_1']
                if ';base64,' not in image_data_url_1:
                     logging.error(f"Invalid image data format for image 1")
                     return ({'error': 'Invalid image data format for image 1'}, 400, response_headers)
                header1, encoded1 = image_data_url_1.split(",", 1)
                image_bytes_1 = base64.b64decode(encoded1)
                logging.info(f"Decoded image 1 size: {len(image_bytes_1)} bytes")

                # Decode Image 2 (Optional)
                image_data_url_2 = data.get('image_data_2')
                if image_data_url_2 and isinstance(image_data_url_2, str) and ';base64,' in image_data_url_2:
                    try:
                        header2, encoded2 = image_data_url_2.split(",", 1)
                        image_bytes_2 = base64.b64decode(encoded2)
                        logging.info(f"Decoded image 2 size: {len(image_bytes_2)} bytes")
                    except Exception as decode_error_2:
                        logging.error(f"Base64 Decode Error for image 2: {decode_error_2}")
                        image_bytes_2 = None
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
                    filename_1 = f"book_covers/{uuid.uuid4()}_img1.jpg" # Keep naming convention
                    blob1 = bucket.blob(filename_1)
                    logging.info(f"Uploading image 1 to gs://{GCS_BUCKET_NAME}/{filename_1}")
                    blob1.upload_from_string(image_bytes_1, content_type='image/jpeg') # Assume JPEG for now
                    image_url_1 = blob1.public_url
                    logging.info(f"Image 1 uploaded successfully: {image_url_1}")

                    # Upload Image 2 if it exists
                    if image_bytes_2:
                        filename_2 = f"book_covers/{uuid.uuid4()}_img2.jpg"
                        blob2 = bucket.blob(filename_2)
                        logging.info(f"Uploading image 2 to gs://{GCS_BUCKET_NAME}/{filename_2}")
                        blob2.upload_from_string(image_bytes_2, content_type='image/jpeg') # Assume JPEG
                        image_url_2 = blob2.public_url
                        logging.info(f"Image 2 uploaded successfully: {image_url_2}")

                except Exception as err:
                    gcs_error = f"GCS Upload Error: {err}"
                    logging.exception(gcs_error)
                    # Reset URLs if upload failed partway
                    if not image_url_1: filename_1 = None
                    if not image_url_2: filename_2 = None
            elif not GCS_BUCKET_NAME:
                 gcs_error = "GCS Bucket name not configured."
                 logging.error(gcs_error)
            elif not image_bytes_1:
                 gcs_error = "Cannot upload, image 1 data missing."
                 logging.error(gcs_error)


            # --- Removed Gemini API Call ---

            # 3. Prepare final response data (Upload URLs only)
            response_data = {
                "message": "Image(s) uploaded successfully.",
                "image_url": image_url_1, # URL for image 1 (primary)
                "image_url_2": image_url_2, # URL for image 2 (if provided)
                "gcs_error": gcs_error,
                # Removed gemini_error, lookup_error, parsed_fields
            }
            logging.info("Sending final response (Upload URLs)")
            return (response_data, 200, response_headers)

        # Catch-all for unexpected errors during POST processing
        except Exception as e:
            logging.exception(f"Unexpected error processing POST request: {e}")
            # Ensure CORS headers even on internal errors
            return ({'error': 'An unexpected internal error occurred'}, 500, response_headers)

    # --- Handle other methods ---
    else:
        logging.warning(f"Received unhandled method: {request.method}")
        response_data = {'error': f"Method {request.method} not allowed."}
        # Ensure CORS headers on 405 response
        return (response_data, 405, response_headers)


