async function downloadPackage() {
    const packageName = document.getElementById('packageName').value;
    const downloadCount = document.getElementById('downloadCount').value;
    const waitTime = document.getElementById('waitTime').value;
    const loader = document.getElementById('loader');
    const progressElement = document.getElementById('progress');
    const responseElement = document.getElementById('response');
    const startViewButton = document.getElementById('startViewButton');
    const progressContainer = document.getElementById('progress-container');

    responseElement.classList.remove('show');
    loader.classList.add('active');
    startViewButton.disabled = true;

    try {
        const response = await fetch(`/download/${packageName}/${downloadCount}`, { method: 'POST' });

        // Check if the response is okay
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const contentLength = +response.headers.get('Content-Length');
        const reader = response.body.getReader();
        let receivedLength = 0;
        let chunks = []; // To accumulate the chunks of data

        progressContainer.style.display = 'block';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            receivedLength += value.length;

            // Push the chunk to the array
            chunks.push(value);
            // Update progress
            progressElement.style.width = `${(receivedLength / contentLength) * 100}%`;
        }

        // Concatenate all chunks into a single Uint8Array
        const concatenatedChunks = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
            concatenatedChunks.set(chunk, position);
            position += chunk.length;
        }

        // Decode the concatenated array to a string
        const responseText = new TextDecoder().decode(concatenatedChunks);
        
        // Parse the response text as JSON
        const data = JSON.parse(responseText);

        // Display the response message
        responseElement.innerText = data.message;
        responseElement.classList.add('show');
    } catch (error) {
        responseElement.innerText = 'An error occurred: ' + error.message;
        responseElement.classList.add('show');
    } finally {
        loader.classList.remove('active');
        startViewButton.disabled = false;
        progressContainer.style.display = 'none';
        progressElement.style.width = '0%'; // Reset progress bar
    }
}

