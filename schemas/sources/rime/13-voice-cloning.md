> ## Documentation Index
> Fetch the complete documentation index at: https://docs.rime.ai/llms.txt
> Use this file to discover all available pages before exploring further.

# Enterprise voice cloning

> Order an enterprise voice clone trained on Coda or Mist.

Enterprise voice cloning is available on Growth and Enterprise plans. Plan for 30 to 60 minutes of clean, consistent recordings for a basic clone; two to five hours or more produce the strongest results.

## Create an enterprise voice clone

<Steps>
  <Step title="Prepare data">
    Use a low-reverb space with only the target speaker. Keep the same microphone, distance, and speaking energy throughout each session. Use a pop filter, retain natural breaths and pauses, and record over multiple days to capture variation without fatigue.

    Separate each line in your script by three to four seconds of silence.

    Include:

    * Brand-specific terminology
    * Alphanumeric sequences (like phone numbers and addresses)
    * The performance and prosody that you're looking for (such as for outbound calling or inbound customer support)

    <Tip>Contact Rime if you need a recording script.</Tip>
  </Step>

  <Step title="Delivery criteria">
    Deliver the audio in the following format:

    * **Channels:** Mono
    * **Format:** Lossless format (`.wav` or `.flac`)
    * **Sampling rate:** At least 44.1kHz
    * **Bit depth:** At least 16-bit
  </Step>

  <Step title="Delivery and completion">
    Deliver the finished audio to the Rime team and specify which foundational model you want the clone trained on: Coda, Mist, or both.

    Turnaround depends on current demand but is most often under seven business days. Rime assigns the voice clone a unique UUID and makes it available through the API under that UUID. For example, if Rime assigns `84462a19-dc31-4f30-91e5-19bfc6415a85`, you can access your clone as follows:

    ```bash theme={null}
    curl --request POST \
        --url https://users.rime.ai/v1/rime-tts \
        --header 'Accept: audio/L16' \
        --header 'Authorization: Bearer YOUR_API_KEY' \
        --header 'Content-Type: application/json' \
        --data '{
        "speaker": "84462a19-dc31-4f30-91e5-19bfc6415a85",
        "text": "<string>",
        "modelId": "coda"
    }'
    ```
  </Step>
</Steps>
