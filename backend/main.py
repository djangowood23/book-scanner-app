import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
import google.generativeai as genai
import json
from dotenv import load_dotenv
import re
import requests # Needed for Google Books API call

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
# GOOGLE_BOOKS_API_KEY = os.environ.get('GOOGLE_BOOKS_API_KEY') # Add later if needed

# --- Configure Gemini ---
gemini_configured = False
if not GEMINI_API_KEY: logging.warning("GEMINI_API_KEY environment variable not set.")
else:
    try: genai.configure(api_key=GEMINI_API_KEY); gemini_configured = True; logging.info("Gemini API configured.")
    except Exception as config_err: logging.error(f"Failed to configure Gemini API: {config_err}")

if not GCS_BUCKET_NAME: logging.warning("GCS_BUCKET_NAME environment variable not set.")


# --- Google Books API Lookup Function ---
def lookup_book_by_isbn(isbn_string):
    """Queries Google Books API using ISBN and returns parsed volume info."""
    if not isbn_string: return None
    cleaned_isbn = re.sub(r'[- ]', '', isbn_string)
    # Use HTTPS
    api_url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{cleaned_isbn}"
    # key_param = os.environ.get('GOOGLE_BOOKS_API_KEY')
    # if key_param: api_url += f"&key={key_param}"
    logging.info(f"Querying Google Books API: {api_url}")
    book_data = None
    try:
        response = requests.get(api_url, timeout=10)
        response.raise_for_status()
        data = response.json()
        if data.get('totalItems', 0) > 0 and 'items' in data:
            volume_info = data['items'][0].get('volumeInfo', {})
            logging.info(f"Google Books API found data for ISBN {cleaned_isbn}")
            title = volume_info.get('title')
            authors = volume_info.get('authors', [])
            publisher = volume_info.get('publisher')
            published_date = volume_info.get('publishedDate')
            language = volume_info.get('language')
            description = volume_info.get('description')
            categories = volume_info.get('categories', [])
            image_links = volume_info.get('imageLinks', {})
            thumbnail_url = image_links.get('thumbnail') or image_links.get('smallThumbnail')
            release_year = None
            if published_date:
                match = re.search(r'\b(\d{4})\b', published_date)
                if match: release_year = match.group(1)
            book_data = {
                "title": title, "author": ", ".join(authors) if authors else None,
                "publisher": publisher, "release_date": release_year, "language": language,
                "description": description, "categories": categories, "stock_image_url": thumbnail_url
            }
        else: logging.warning(f"Google Books API returned no items for ISBN {cleaned_isbn}")
    except requests.exceptions.RequestException as req_err: logging.error(f"Google Books API request failed for {cleaned_isbn}: {req_err}")
    except Exception as e: logging.exception(f"Error during Google Books API lookup for {cleaned_isbn}: {e}")
    return book_data
# --- End Google Books API Lookup Function ---


@functions_framework.http
def handle_process_image(request):
    """Handles OPTIONS/POST: Decodes, uploads, calls Gemini, calls Google Books, merges."""

    # --- Handle OPTIONS preflight request ---
    if request.method == 'OPTIONS':
        logging.info("Handling OPTIONS request")
        return ('', 204, CORS_HEADERS)

    # --- Handle POST request ---
    elif request.method == 'POST':
        logging.info("Handling POST request (V2 - Gemini + GBooks Lookup)")
        # Initialize variables
        image_bytes_1 = None; image_bytes_2 = None
        image_url_1 = None; image_url_2 = None
        filename_1 = None; filename_2 = None
        gcs_error = None; gemini_error = None; lookup_error = None
        parsed_fields_dict = None # From Gemini
        google_books_data = None # From Google Books API
        stock_image_url = None # From Google Books API

        response_headers = CORS_HEADERS.copy()
        response_headers['Content-Type'] = 'application/json'

        try:
            # 1. Decode Base64 Images (Keep existing logic)
            # ... (Decoding logic as before) ...
            try:
                data = request.get_json(silent=True);
                if not data or 'image_data_1' not in data: return ({'error': 'Missing image_data_1'}, 400, response_headers)
                image_data_url_1 = data['image_data_1']
                if ';base64,' not in image_data_url_1: return ({'error': 'Invalid image data format for image 1'}, 400, response_headers)
                header1, encoded1 = image_data_url_1.split(",", 1); image_bytes_1 = base64.b64decode(encoded1)
                logging.info(f"Decoded image 1 size: {len(image_bytes_1)} bytes")
                image_data_url_2 = data.get('image_data_2')
                if image_data_url_2 and isinstance(image_data_url_2, str) and ';base64,' in image_data_url_2:
                    try: header2, encoded2 = image_data_url_2.split(",", 1); image_bytes_2 = base64.b64decode(encoded2); logging.info(f"Decoded image 2 size: {len(image_bytes_2)} bytes")
                    except Exception as decode_error_2: logging.error(f"Base64 Decode Error for image 2: {decode_error_2}"); image_bytes_2 = None
                else: logging.info("No valid image_data_2 provided."); image_bytes_2 = None
            except Exception as decode_error_1: logging.error(f"Base64 Decode Error for image 1: {decode_error_1}"); return ({'error': 'Failed to decode base64 image_data_1'}, 400, response_headers)


            # 2. Upload images to GCS (Keep existing logic)
            if image_bytes_1 and GCS_BUCKET_NAME: # ... (GCS upload logic as before) ...
                try:
                    storage_client = storage.Client(); bucket = storage_client.bucket(GCS_BUCKET_NAME)
                    filename_1 = f"book_covers/{uuid.uuid4()}_img1.jpg"; blob1 = bucket.blob(filename_1)
                    logging.info(f"Uploading image 1 to gs://{GCS_BUCKET_NAME}/{filename_1}"); blob1.upload_from_string(image_bytes_1, content_type='image/jpeg')
                    image_url_1 = blob1.public_url; logging.info(f"Image 1 uploaded successfully: {image_url_1}")
                    if image_bytes_2:
                        filename_2 = f"book_covers/{uuid.uuid4()}_img2.jpg"; blob2 = bucket.blob(filename_2)
                        logging.info(f"Uploading image 2 to gs://{GCS_BUCKET_NAME}/{filename_2}"); blob2.upload_from_string(image_bytes_2, content_type='image/jpeg')
                        image_url_2 = blob2.public_url; logging.info(f"Image 2 uploaded successfully: {image_url_2}")
                except Exception as err: gcs_error = f"GCS Upload Error: {err}"; logging.exception(gcs_error); pass
            elif not GCS_BUCKET_NAME: gcs_error = "GCS Bucket name not configured."; logging.error(gcs_error)

            # 3. Call Gemini Vision API (Keep existing logic)
            if image_bytes_1 and gemini_configured: # ... (Gemini API call logic as before, populating parsed_fields_dict and gemini_error) ...
                 try:
                     logging.info("Calling Gemini API..."); model = genai.GenerativeModel('gemini-1.5-flash-latest')
                     prompt = """Analyze the provided image(s)... [USE THE FULL PROMPT FROM PREVIOUS STEP, asking for title, author, isbn, publisher, release_date, language, edition, signature, volume, and price estimate] ... Ensure the output is ONLY the JSON object.""" # Shortened
                     image_part_1 = {"mime_type": "image/jpeg", "data": image_bytes_1}; content_parts = [prompt, image_part_1]
                     if image_bytes_2: image_part_2 = {"mime_type": "image/jpeg", "data": image_bytes_2}; content_parts.append(image_part_2); logging.info(f"Sending 2 images to Gemini.")
                     else: logging.info(f"Sending 1 image to Gemini.")
                     response = model.generate_content(content_parts); logging.info("Gemini response received.")
                     try: # Parse JSON
                         response_text = response.text.strip(); json_start = response_text.find('{'); json_end = response_text.rfind('}')
                         if json_start != -1 and json_end != -1 and json_end > json_start:
                              json_text = response_text[json_start:json_end+1]; parsed_fields_dict = json.loads(json_text)
                              logging.info("Successfully parsed JSON response from Gemini."); logging.info(f"Gemini Parsed Fields: {parsed_fields_dict}")
                         else: raise ValueError(f"No valid JSON object found: {response_text[:500]}")
                     except Exception as json_err: gemini_error = f"Failed to parse JSON from Gemini: {json_err} | Response: {getattr(response, 'text', 'N/A')[:500]}"; logging.error(gemini_error); parsed_fields_dict = None
                     if hasattr(response, 'prompt_feedback') and response.prompt_feedback.block_reason: block_reason = f"Gemini blocked: {response.prompt_feedback.block_reason}"; logging.error(block_reason); gemini_error = f"{gemini_error or ''} | {block_reason}".strip(" | "); parsed_fields_dict = None
                 except Exception as gemini_api_error: gemini_error = f"Gemini API Call Failed: {gemini_api_error}"; logging.exception(gemini_error); parsed_fields_dict = None
            elif not gemini_configured: gemini_error = "Gemini API Key not configured."; logging.error(gemini_error)
            else: gemini_error = "Skipping Gemini: Image 1 missing."; logging.warning(gemini_error)

            # 4. Initialize final fields structure (using Zoobilee names)
            final_parsed_fields = {
                "title": None, "author": None, "isbn": None, "publisher": None,
                "release_date": None, "language": None, "edition": None,
                "signature": None, "volume": None, "price": None, # Added Volume & Price
                "media": None, # Add potentially inferrable fields
                # Fields primarily from GBooks or manual entry:
                 "description": None, "categories": None, "cond_text": None, "jcond_text": None
            }
            # Populate initially from Gemini results if they exist
            if isinstance(parsed_fields_dict, dict):
                 for key in final_parsed_fields.keys():
                      # Use .get() to safely access keys potentially missing from Gemini JSON
                      if key in parsed_fields_dict: # Check if Gemini provided the key
                            final_parsed_fields[key] = parsed_fields_dict.get(key)


            # --- INTEGRATE Google Books API Call ---
            isbn_to_lookup = final_parsed_fields.get('isbn') # Get ISBN found by Gemini (or maybe manually entered later?)
            if isbn_to_lookup:
                logging.info(f"ISBN '{isbn_to_lookup}' found, attempting Google Books lookup.")
                google_books_data = lookup_book_by_isbn(isbn_to_lookup) # Call the lookup function

                if google_books_data:
                    logging.info("Google Books data found! Merging results.")
                    # Merge/Overwrite fields - Prioritize Google Books for accuracy if found
                    final_parsed_fields['title'] = google_books_data.get('title') or final_parsed_fields.get('title')
                    final_parsed_fields['author'] = google_books_data.get('author') or final_parsed_fields.get('author')
                    final_parsed_fields['publisher'] = google_books_data.get('publisher') or final_parsed_fields.get('publisher')
                    final_parsed_fields['release_date'] = google_books_data.get('release_date') or final_parsed_fields.get('release_date') # Year from lookup
                    final_parsed_fields['language'] = google_books_data.get('language') or final_parsed_fields.get('language')
                    # Add description/categories if available from lookup
                    final_parsed_fields['description'] = google_books_data.get('description')
                    final_parsed_fields['categories'] = google_books_data.get('categories')
                    # Get stock image URL
                    stock_image_url = google_books_data.get('stock_image_url')
                    if stock_image_url:
                        logging.info(f"Found stock image URL from Google Books: {stock_image_url}")
                    lookup_error = None # Clear lookup error if successful
                else:
                    lookup_error = f"Google Books lookup using ISBN '{isbn_to_lookup}' failed or returned no data."
                    logging.warning(lookup_error)
            else:
                logging.info("No ISBN found by Gemini to perform Google Books lookup.")
                lookup_error = "No ISBN available from Gemini for lookup."
            # --- End Integration Point ---


            # 5. Prepare final response data
            # Use stock image URL if found (Option B), else use captured image URL
            final_image_url_for_aob = stock_image_url if stock_image_url else image_url_1

            response_data = {
                "message": "Image(s) processed via Gemini & Google Books Lookup attempted.",
                "image_url": final_image_url_for_aob, # Primary image URL for form/Zoobilee
                "image_url_2": image_url_2, # Secondary image URL
                "gcs_error": gcs_error,
                "gemini_error": gemini_error,
                "lookup_error": lookup_error, # Include lookup status/error
                "parsed_fields": final_parsed_fields # Merged data
            }
            logging.info("Sending final response")
            return (response_data, 200, response_headers)

        # Catch-all for unexpected errors
        except Exception as e:
            logging.exception(f"Unexpected error processing POST request: {e}")
            return ({'error': 'An unexpected internal error occurred'}, 500, response_headers)

    # --- Handle other methods ---
    else:
        logging.warning(f"Received unhandled method: {request.method}")
        response_data = {'error': f"Method {request.method} not allowed."}
        return (response_data, 405, response_headers)
