import os
import json
import uuid
from flask import Request, jsonify
from google.cloud import storage

# Environment variables
BUCKET  = os.getenv("GCS_BUCKET_NAME")
PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT")

# Init GCS client
storage_client = storage.Client(project=PROJECT)
bucket = storage_client.bucket(BUCKET)

def upload_to_gcs(file_storage):
    ext  = os.path.splitext(file_storage.filename)[1] or ".jpg"
    blob = bucket.blob(f"book_covers/{uuid.uuid4()}{ext}")
    blob.upload_from_file(
        file_storage.stream,
        content_type=file_storage.mimetype
    )
    blob.make_public()
    return blob.public_url

def save_entry(request: Request):
    if request.method != "POST":
        return ("POST only", 405)

    # Parse metadata
    meta_json = request.form.get("meta")
    if not meta_json:
        return ("meta field missing", 400)
    try:
        meta = json.loads(meta_json)
    except json.JSONDecodeError:
        return ("bad meta JSON", 400)

    # Parse images
    files = request.files.getlist("images")
    if not files:
        return ("need image", 400)

    # Upload first image and attach URL
    meta["image_url"] = upload_to_gcs(files[0])

    # Return the full row back to the client
    return jsonify(meta)

