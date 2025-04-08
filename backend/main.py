import base64
import functions_framework
from flask import Flask, request, jsonify
from flask_cors import CORS # Import CORS
import os
from dotenv import load_dotenv
import logging # Import logging
from google.cloud import storage # For GCS
from google.cloud import vision # For Vision API
import uuid # For unique filenames
import re # For parsing ISBN

# Set up basic logging
logging.basicConfig(level=logging.INFO)

load_dotenv() # Load environment variables from .env file for local testing

# If deploying as a single function, use functions-framework
# If deploying a full Flask app (e.g. to Cloud Run), adjust structure
app = Flask(__name__)
CORS(app) # Enable CORS for all routes to allow requests from frontend

# Load sensitive info from environment
GCS_BUCKET_NAME = os.environ.get('GCS_BUCKET_NAME')
GOOGLE_CLOUD_PROJECT = os.environ.get('GOOGLE_CLOUD_PROJECT')

# Log startup confirmation
if GCS_BUCKET_NAME:
    logging.info(f"GCS Bucket Name loaded: {GCS_BUCKET_NAME}")
else:
    logging.warning("GCS_BUCKET_NAME environment variable not set.")
if GOOGLE_CLOUD_PROJECT:
     logging.info(f"GCP Project ID loaded: {GOOGLE_CLOUD_PROJECT}")

@app.route('/api/process-image', methods=['POST'])
def handle_process_image():
    """Receives image data, uploads to GCS, calls Vision API, parses text."""
    logging.info("Received request at /api/process-image")
    image_bytes = None
    image_url = None
    filename = None
    extracted_text = None
    vision_error = None
    parsed_title = None
    parsed_author = None
    parsed_isbn = None

    try:
        data = request.get_json()
        if not data or 'image_data' not in data:
            logging.error("Missing image_data in request")
            return jsonify({"error": "Missing image_data"}), 400

        image_data_url = data['image_data']
        # Basic check for data URL format
        if ';base64,' not in image_data_url:
             logging.error(f"Invalid image data format: {image_data_url[:50]}...")
             return jsonify({"error": "Invalid image data format, expected base64 data URL"}), 400

        # Decode base64 image data (remove the prefix first)
        try:
            header, encoded = image_data_url.split(",", 1)
            image_bytes = base64.b64decode(encoded)
            logging.info(f"Decoded image size: {len(image_bytes)} bytes")
        except Exception as decode_error:
            logging.error(f"Base64 Decode Error: {decode_error}")
            return jsonify({"error": "Failed to decode base64 image data"}), 400

        # --- Upload image to GCS ---
        if image_bytes and GCS_BUCKET_NAME:
            try:
                storage_client = storage.Client()
                bucket = storage_client.bucket(GCS_BUCKET_NAME)
                filename = f"book_covers/{uuid.uuid4()}.jpg"
                blob = bucket.blob(filename)

                logging.info(f"Uploading image to gs://{GCS_BUCKET_NAME}/{filename}")
                blob.upload_from_string(image_bytes, content_type='image/jpeg')
                image_url = blob.public_url # Requires public access
                logging.info(f"Image uploaded successfully: {image_url}")

            except Exception as gcs_error:
                logging.exception(f"GCS Upload Error: {gcs_error}")
                pass # Log error, continue, image_url will be None
        elif not GCS_BUCKET_NAME:
             logging.error("Cannot upload to GCS: Bucket name not configured.")

        # --- Call Google Cloud Vision API ---
        if filename: # Only call Vision if GCS upload seemed ok (filename assigned)
            try:
                logging.info(f"Calling Vision API for image gs://{GCS_BUCKET_NAME}/{filename}")
                vision_client = vision.ImageAnnotatorClient()
                image = vision.Image()
                image.source.image_uri = f"gs://{GCS_BUCKET_NAME}/{filename}"
                feature = vision.Feature(type_=vision.Feature.Type.TEXT_DETECTION)
                request_vision = vision.AnnotateImageRequest(image=image, features=[feature])
                response = vision_client.annotate_image(request=request_vision)

                if response.error.message:
                    vision_error = f'Vision API Error: {response.error.message}'
                    logging.error(vision_error)
                elif response.full_text_annotation:
                    extracted_text = response.full_text_annotation.text
                    logging.info(f"Vision API extracted text (first 100 chars): {extracted_text[:100].replace('\n', ' ')}...")
                else:
                    logging.info("Vision API found no text annotation.")
                    extracted_text = ""

            except Exception as vision_api_error:
                vision_error = f"Vision API Call Failed: {vision_api_error}"
                logging.exception(vision_error)
        else:
             vision_error = "Skipping Vision API call because image filename from GCS is missing."
             logging.warning(vision_error)

        # --- Basic Parsing Logic ---
        if extracted_text: # Only parse if Vision API was successful and returned text
            lines = extracted_text.strip().split('\n')
            lines = [line.strip() for line in lines if line.strip()] # Remove empty lines
            logging.info(f"Attempting to parse {len(lines)} non-empty lines of text.")

            # Basic ISBN parsing
            isbn_pattern = re.compile(r'\b(?:ISBN(?:-1[03])?:?\s*)?((?:97[89]-?)?\d(?:-?\d){8,11}[\dX])\b', re.IGNORECASE)
            for line in lines:
                match = isbn_pattern.search(line.replace(' ', ''))
                if match:
                    parsed_isbn = re.sub(r'[- ]', '', match.group(1))
                    logging.info(f"Found potential ISBN: {parsed_isbn}")
                    break

            # Basic Author parsing
            author_line_index = -1
            for i, line in enumerate(lines):
                line_lower = line.lower()
                if line_lower.strip() == 'by' or ' by ' in line_lower:
                     if i + 1 < len(lines) and lines[i+1] != parsed_isbn:
                         parsed_author = lines[i+1]
                         author_line_index = i+1
                         logging.info(f"Found potential Author: {parsed_author}")
                         break
                elif i > 0 and lines[i-1].lower().endswith(' by'):
                     if lines[i] != parsed_isbn:
                          parsed_author = lines[i]
                          author_line_index = i
                          logging.info(f"Found potential Author (alt): {parsed_author}")
                          break

            # Basic Title parsing (longest line not author/isbn)
            longest_line = ""
            for i, line in enumerate(lines):
                if i != author_line_index and len(line) > len(longest_line):
                     if len(line) > 3 and line != parsed_isbn:
                          longest_line = line
            if longest_line:
                parsed_title = longest_line
                logging.info(f"Found potential Title: {parsed_title}")
        elif vision_error is None: # Only log if no text and no prior vision error
            logging.info("No extracted text to parse.")
        # --- End Parsing Logic ---

        # Final response data including parsed fields
        response_data = {
            "message": "Image processed.",
            "received_image_size": len(image_bytes) if image_bytes else 0,
            "image_url": image_url,
            "vision_error": vision_error,
            "extracted_text_raw": extracted_text,
            "parsed_fields": { # Use parsed values (will be None if not found)
                "title": parsed_title,
                "author": parsed_author,
                "isbn": parsed_isbn,
            }
        }
        logging.info("Sending response with parsed fields")
        return jsonify(response_data)

    # Catch-all for unexpected errors in the main request handling
    except Exception as e:
        logging.exception(f"Unexpected error processing request: {e}")
        return jsonify({"error": "An unexpected internal error occurred"}), 500

# GCF entry point
@functions_framework.http
def main_handler(request):
    with app.request_context(request.environ):
        return app.full_dispatch_request()

# Local testing runner
if __name__ == '__main__':
    logging.info("Attempting to run Flask locally...")
    app.run(debug=True, host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))
