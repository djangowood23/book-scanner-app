'use strict';

// Get references to HTML elements
const video = document.getElementById('videoElement');
const canvas = document.getElementById('canvasElement');
const captureButton = document.getElementById('captureButton');
const snapshotImg = document.getElementById('snapshot');
const context = canvas.getContext('2d');

// Constraints for the camera - try to get the back camera ('environment')
const constraints = {
    video: {
        facingMode: "environment" // Use 'user' for front camera
    }
};

// Function to start the camera stream
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = stream;
        console.log("Camera stream started.");
    } catch (err) {
        console.error("Error accessing camera: ", err);
        alert("Could not access camera. Please ensure permission is granted and potentially using HTTPS.");
    }
}

// Event listener for the capture button
captureButton.addEventListener('click', () => {
    console.log("Capture button clicked.");

    // Set canvas dimensions to match video stream dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw the current video frame onto the hidden canvas
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Get the image data from the canvas as a JPEG data URL
    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.9); // Quality 0.9

    // Display the snapshot (optional)
    snapshotImg.src = imageDataUrl;
    snapshotImg.style.display = 'block'; // Make it visible
    console.log("Snapshot taken and displayed.");

    // --- Send data to DEPLOYED backend ---
    console.log("Attempting to send image data to deployed backend...");
    // *** THIS URL HAS BEEN UPDATED ***
    fetch('https://us-central1-aob-scanner.cloudfunctions.net/book-scanner-process-image', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        // Send the image data as a JSON object
        body: JSON.stringify({ image_data: imageDataUrl }),
    })
    .then(response => {
        // Check if the response was successful (status code 200-299)
        if (!response.ok) {
            // If not okay, throw an error to be caught by .catch()
            // We'll try to get the error message from the backend JSON response
            return response.json().then(errData => {
                throw new Error(`HTTP error! status: ${response.status}, message: ${errData.error || 'Unknown error'}`);
            }).catch(() => {
                // Fallback if the error response wasn't JSON
                throw new Error(`HTTP error! status: ${response.status}`);
            });
        }
        // If okay, parse the JSON response body
        return response.json();
    })
    .then(data => {
        // Log the data received from the backend
        console.log('Data received from backend:', data);
        // TODO: Use the data (parsed text, fields) returned from backend
        // to populate your form fields. We'll do this later.
        alert("Image sent and response received! Check browser console."); // Simple feedback
    })
    .catch((error) => {
        // Log any errors that occurred during the fetch
        console.error('Error sending image to backend:', error);
        alert(`Failed to send image for processing. Error: ${error.message}. Check browser console and backend logs.`);
    });

});

// Start the camera when the page loads
startCamera();
