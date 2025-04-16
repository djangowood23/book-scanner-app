import functions_framework
import logging
import base64
import os
import uuid
from google.cloud import storage
import google.generativeai as genai
import json
from dotenv import load_dotenv
import requests  # For potential future use

logging.basicConfig(level=logging.INFO)
load_dotenv()  # Load .env file for local testing

# --- Define CORS Headers ---
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
}

# ===== NEW/UPDATED FUNCTION: process_book_images =====
def process_book_images(image_data_1, image_data_2):
    """
    Call Gemini with a prompt that instructs Book Value Snap to:
    1. Extract bibliographic details.
    2. Retrieve an average fair market value price.
    
    NOTE: The output JSON keys must be exactly: title, author, isbn, publisher, release_date,
    language, edition, signature, and price.
    """
    prompt = (
        "You are Book Value Snap, a sophisticated book pricing and bibliographic data extraction assistant. "
        "When given uploaded images of a book's cover and/or ISBN/barcode, perform the following tasks:\n\n"
        "1. Extract key bibliographic details: title, author, isbn, publisher, release_date, language, edition, and signature.\n"
        "2. For ISBN images, use the ISBN directly to look up book details; for cover images, identify and translate all text before searching.\n"
        "3. Retrieve pricing data by comparing offers from bookscouter.com, AbeBooks, Biblio, Amazon, Alibris, Rare Book Cellar, Bauman Rare Books, and eBay, then calculate the best average sale price.\n"
        "4. Accept any additional details (e.g., First Edition, Signed, Hardcover, Softcover, Condition) if available.\n\n"
        "Return the results strictly as JSON with these keys: title, author, isbn, publisher, release_date, language, edition, signature, and price. "
        "If a field is unavailable, leave it blank.\n\n"
        "Input images (as base64 data):\n"
        "Image 1: {img1}\n"
        "Image 2: {img2}\n"
    ).format(img1=image_data_1, img2=(image_data_2 if image_data_2 is not None else "N/A"))
    
    # Set the Gemini API key using the provided key (no fill-in required now)
    genai.api_key = os.environ.get("GEMINI_API_KEY", "AIzaSyC1daQwx_rLg2f32r8_UXOfHlcPoXjAX1I")
    
    response = genai.generate_text(
        model=os.environ.get("GEMINI_MODEL", "gemini-1.5-flash-latest"),
        prompt=prompt,
        max_output_tokens=300
    )
    
    try:
        result_json = json.loads(response.result.strip())
    except Exception as e:
        result_json = {"error": "Error parsing Gemini output: " + str(e)}
    
    return result_json
# ===== END OF process_book_images =====

# ===== MODIFIED HTTP HANDLER =====
@functions_framework.http
def handle_process_image(request):
    # Handle preflight (OPTIONS) requests
    if request.method == "OPTIONS":
        return ("", 204, CORS_HEADERS)
    
    request_json = request.get_json()
    image_data_1 = request_json.get("image_data_1")
    image_data_2 = request_json.get("image_data_2")
    
    if not image_data_1:
        return (json.dumps({"error": "No image data provided."}), 400, CORS_HEADERS)
    
    # Process images using the updated Gemini prompt function
    parsed_fields = process_book_images(image_data_1, image_data_2)
    
    # Here you could add your storage logic; for now we use a fixed URL
    image_url = "https://aob-scanner-book-images.storage.googleapis.com/some_image.jpg"
    
    response_data = {
        "parsed_fields": parsed_fields,
        "image_url": image_url
    }
    
    return (json.dumps(response_data), 200, CORS_HEADERS)
# ===== END OF handle_process_image =====

