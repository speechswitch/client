> This is a page from the ElevenLabs documentation. For a complete page index, fetch https://elevenlabs.io/docs/llms.txt. For the full documentation in a single file, fetch https://elevenlabs.io/docs/llms-full.txt.

# Text to Speech

## Overview

ElevenLabs' Text to Speech technology is integral to our offerings, powering high-quality AI-generated speech across various applications worldwide. It's likely you've already encountered our voices in action, delivering lifelike audio experiences.

To get started generating your first audio using Text to Speech, it's very simple. However, to get the most out of this feature, there are a few things you need to keep in mind.

## Guide

![Text to Speech demo](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/32b6abef4b76c8652b0e55dbb26c9694fdc82e191a062678b93c9a5ca5d80c94/assets/images/product-guides/text-to-speech/text-to-speech-demo.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=22ca21c18a5e6b588ba801eca478235431b105c8d9c60f69f6e083559d0e9c53&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

#### Adjust settings (optional)

#### Text input

Type or paste your text into the input box on the Text to Speech page.

#### Voice selection

Select the voice you wish to use from your Voices at the bottom left of the screen.

#### Adjust settings (optional)

Modify the voice settings for the desired output.

#### Generate

Click the 'Generate' button to create your audio file.

## Settings

Get familiar with the voices, models & settings for creating high-quality speech.

The settings you use, especially the voice and the model, significantly impact the output. It's quite important to get familiar with these and understand some best practices. While other settings also influence the output, their impact is less significant compared to the voice and model you select.

The order of importance goes as follows: **Voice** selection is most important, followed by **Model** selection, and then model **Settings**. All of these, and their combination, will influence the output.

#### Voices

### Voices

![Text to Speech voice
selection](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/a1a2f62118fa246f300c666a5a4f3fbd18cc9bfed023a8c6a010782545da1254/assets/images/product-guides/text-to-speech/text-to-speech-voices.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=14652a3c5f51e869e970d8b4d93f9f79facebb66add3f6453a06a650bee823df&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

We offer many types of voices, including the curated **Default Voices**, our vast **Voices Library&#x20;**&#x77;ith almost any voices you can imagine, completely synthetic voices created using our **Voice Design** tool, and you can create your own collection of cloned voices using our two technologies: **Instant Voice Cloning** and **Professional Voice Cloning**.

Not all voices are equal, and much depends on the source audio used to create them. Some voices will provide a better, more human performance and delivery, while others will be more stable.

**Choosing the right voice for your specific content is crucial.** This is most likely the most significant decision that will have the most significant impact on the final output. It determines the gender, tone, accent, cadence, and delivery. It's worth spending extra time to select the perfect voice and properly test it to ensure it is consistent and meets your expectations.

For generating speech in a specific language, using a native voice from the Voice Library or cloning a voice speaking that language with the correct accent will yield the best results. While any voice can technically speak any language, it will retain its original accent. For example, using a native English voice to generate French speech will likely result in the output being in French but with an English accent, as the AI must generalize how that voice would sound in a language it wasn't trained on.

[Learn more about voices](/docs/overview/capabilities/voices)

If you have a voice that you like but want a different delivery, our [Voice Remixing](/docs/overview/capabilities/voice-remixing) tool can help. It lets you use natural language prompts to change a voice's delivery, cadence, tone, gender, and even accents. When changing accents, the base voice and target accent are very important. Results can vary; sometimes it works perfectly, while other times it might take a few tries to get it right.

You can get some really good results with Voice Remixing, but they will not usually be as good as a properly cloned Professional Voice Clone. They will be closer to that of an Instant Voice Clone.

Keep in mind, voice remixing only works for specific voices. For example, you can't remix voices from the Voice Library; you can only remix voices that you have created yourself or the default voices.

#### Models

### Models

![Text to Speech model
selection](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/aa32e23cc2a196a48ff47650249e612e7e5da023fd2f69244f27c5fea7968b75/assets/images/product-guides/text-to-speech/text-to-speech-models.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=794920da8a0a495e59f766725244633bdb46594471b7c27364723aa79a3d4002&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

We offer two families of models: **Standard (high-quality)** models and **Flash** models, which are optimized for extremely low latency. Most families include both English-only and multilingual versions.

*The Eleven v3 model currently only comes in one version: the standard multilingual version.*

Model selection is the second most significant influence on your final audio output, right after voice selection. We recommend taking a moment to test the different models with your chosen voice to find the best fit. All of our models have strengths and weaknesses and work better with some voices than others, so finding a good pairing is important.

If your output will be exclusively in English, we strongly recommend using one of our English-only models. They are often easier to work with, more stable, and generally offer superior performance for English-only content. If your content will be in another language or potentially multilingual, you must use one of the multilingual models.

#### [Eleven v3](/docs/overview/models#eleven-v3)

Our most emotionally rich, expressive speech synthesis model

Dramatic delivery and performance

70+ languages supported

5,000 character limit

Support for natural multi-speaker dialogue

#### [Eleven v3 Conversational](/docs/overview/models#eleven-v3-conversational)

Our most expressive, realtime speech synthesis model

Low latency (\~280ms)

Dramatic delivery and performance

70+ languages supported

Audio tags for fine-grained control

#### [Eleven Multilingual v2](/docs/overview/models#multilingual-v2)

Lifelike, consistent quality speech synthesis model

Natural-sounding output

29 languages supported

10,000 character limit

Most stable on long-form generations

#### [Eleven Flash v2.5](/docs/overview/models#flash-v25)

Our fast, affordable speech synthesis model

Ultra-low latency (\~75ms†)

32 languages supported

40,000 character limit

Faster model, 50% lower price per character for API generations

[Learn more about our models](/docs/overview/models)

#### Voice settings

### Voice settings

![Text to Speech voice
settings](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/9e08b179bfd640650ca5225b7e2e5b8d9d4c192d63a80d2478e4078e408bf869/assets/images/product-guides/text-to-speech/text-to-speech-settings.webp?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=ecb3554f5f3d61a976184732b0a63ae87aca2dd071726d82d640619792b4433d&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

The most common setting is stability around 50, similarity around 75, and keeping style at 0, with minimal changes thereafter. Of course, this all depends on the original voice and the style of performance you're aiming for.

It's important to note that the AI is non-deterministic; setting the sliders to specific values won't guarantee the same results every time. Instead, the sliders function more as a range, determining how wide the randomization can be between each generation.

#### Speed

The speed setting allows you to either speed up or slow down the speed of the generated speech. The default value is 1.0, which means that the speed is not adjusted. Values below 1.0 will slow the voice down, to a minimum of 0.7. Values above 1.0 will speed up the voice, to a maximum of 1.2. Extreme values may affect the quality of the generated speech.

Speed is not available for the Eleven v3 model.

#### Stability

The stability slider determines how stable the voice is and the randomness between each generation. Lowering this slider introduces a broader emotional range for the voice. As mentioned before, this is also influenced heavily by the original voice. Setting the slider too low may result in odd performances that are overly random and cause the character to speak too quickly. On the other hand, setting it too high can lead to a monotonous voice with limited emotion.

For a more lively and dramatic performance, it is recommended to set the stability slider lower and generate a few times until you find a performance you like.

On the other hand, if you want a more serious performance, even bordering on monotone at very high values, it is recommended to set the stability slider higher. Since it is more consistent and stable, you usually don't need to generate as many samples to achieve the desired result. Experiment to find what works best for you!

#### Similarity

The similarity slider dictates how closely the AI should adhere to the original voice when attempting to replicate it. If the original audio is of poor quality and the similarity slider is set too high, the AI may reproduce artifacts or background noise when trying to mimic the voice if those were present in the original recording.

Similarity is not available for the Eleven v3 model.

#### Style exaggeration

With the introduction of the newer models, we also added a style exaggeration setting. This setting attempts to amplify the style of the original speaker. It does consume additional computational resources and might increase latency if set to anything other than 0. It's important to note that using this setting has shown to make the model slightly less stable, as it strives to emphasize and imitate the style of the original voice.

*In general, we recommend keeping this setting at 0 at all times.*

#### Speaker Boost

This setting boosts the similarity to the original speaker. However, using this setting requires a slightly higher computational load, which in turn increases latency. The differences introduced by this setting are generally rather subtle.

Speaker Boost is not available for the Eleven v3 model.

## Generate

Once you have selected your voice, chosen a model, and configured your settings, the generation process is straightforward: you input text, press "**Generate Speech**," and the audio is then generated.

Although the process is very simple on the surface, the text input you provide is extremely important for achieving the desired output. When using words that might be "outside of distribution"—meaning things the AI rarely encountered during training—such as strange names, unusual abbreviations, symbols, or even emojis, you can risk confusing the AI and making the output more unstable. Emojis and certain symbols are particularly difficult for the AI to interpret correctly.

When using Text to Speech via the UI, we run an automated normalization step on your input to improve text legibility and ease processing for the AI. Generally, this step converts symbols and numbers into written-out text, which guides the AI on correct pronunciation.

A best practice we strongly recommend is to avoid writing numbers as digits or using symbols, especially when using multilingual models (though this also applies to English-only models). Since numbers and symbols are written the same across many languages but pronounced differently, relying on digits creates ambiguity for the AI. For example, the number "1" is written identically in English and many other languages but pronounced differently. Writing out the number in text, such as "one," removes the need for the AI to interpret what it is supposed to do.

We are working on more advanced workflows to allow you to influence the AI's delivery and performance using what we call **Audio Tags**. This feature is available in our Eleven v3 model. If you're interested in learning more about this feature, we recommend reading our [Eleven v3 documentation](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3).

## FAQ

<tbody>
  <tr>
    <td>
      #### Good input equals good output

      The first factor, and one of the most important, is that good, high-quality, and consistent input will result in good, high-quality, and consistent output.

      If you provide the AI with audio that is less than ideal—for example, audio with a lot of noise, reverb on clear speech, multiple speakers, or inconsistency in volume or performance and delivery—the AI will become more unstable, and the output will be more unpredictable.

      If you plan on cloning your own voice, we strongly recommend that you go through our guidelines in the documentation for creating proper voice clones, as this will provide you with the best possible foundation to start from. Even if you intend to use only Instant Voice Clones, it is advisable to read the Professional Voice Cloning section as well. This section contains valuable information about creating voice clones, even though the requirements for these two technologies are slightly different.
    </td>
  </tr>

  <tr>
    <td>
      #### Use the right voice

      The second factor to consider is that the voice you select will have a tremendous effect on the output. Not only, as mentioned in the first factor, is the quality and consistency of the samples used to create that specific clone extremely important, but also the language and tonality of the voice.

      If you want a voice that sounds happy and cheerful, you should use a voice that has been cloned using happy and cheerful samples. Conversely, if you desire a voice that sounds introspective and brooding, you should select a voice with those characteristics.

      However, it is also crucial to use a voice that has been trained in the correct language. For example, all of the professional voice clones we offer as default voices are English voices and have been trained on English samples. Therefore, if you have them speak other languages, their performance in those languages can be unpredictable. It is essential to use a voice that has been cloned from samples where the voice was speaking the language you want the AI to then speak.
    </td>
  </tr>

  <tr>
    <td>
      #### Use proper formatting

      This may seem slightly trivial, but it can make a big difference. The AI tries to understand how to read something based on the context of the text itself, which means not only the words used but also how they are put together, how punctuation is applied, the grammar, and the general formatting of the text.

      This can have a small but impactful influence on the AI's delivery. If you were to misspell a word, the AI won't correct it and will try to read it as written.
    </td>
  </tr>

  <tr>
    <td>
      #### Nondeterministic

      The settings of the AI are nondeterministic, meaning that even with the same initial conditions (voice, settings, model), it will give you slightly different output, similar to how a voice actor will deliver a slightly different performance each time.

      This variability can be due to various factors, such as the options mentioned earlier: voice, settings, model. Generally, the breadth of that variability can be controlled by the stability slider. A lower stability setting means a wider range of variability between generations, but it also introduces inter-generational variability, where the AI can be a bit more performative.

      A wider variability can often be desirable, as setting the stability too high can make certain voices sound monotone as it does give the AI the same leeway to generate more variable content. However, setting the stability too low can also introduce other issues where the generations become unstable, especially with certain voices that might have used less-than-ideal audio for the cloning process.

      The default setting of 50 is generally a great starting point for most applications.
    </td>
  </tr>

  <tr>
    <td>
      #### What is Eleven v3 (Alpha)?

      Eleven v3 is our latest and most expressive Text to Speech model, offering:

      * More human-like generations with higher quality overall
      * Support for audio tags
        * emotions: `[sad]` `[angry]` `[happily]`
        * delivery direction: `[whispers]` `[shouts]`
        * non-verbal reactions: `[laughs]` `[clears throat]` `[sighs]`
      * Dialogue mode to support natural sounding audio with multiple speakers
      * Support for 70+ languages

      It can produce breathtaking output, but its more variable consistency and higher latency mean it’s not suitable for real-time or conversational use cases. For those, we recommend Flash v2 (English) or v2.5 (Multilingual). We’re working on a real-time version of Eleven v3.

      You can generate using v3 via API using our [Create speech](/docs/api-reference/text-to-speech/convert) and [Stream speech](/docs/api-reference/text-to-speech/stream) endpoints by specifying model ID `eleven_v3`.

      You can also use our [Create dialogue](/docs/api-reference/text-to-dialogue/convert) and [Stream dialogue](/docs/api-reference/text-to-dialogue/stream) endpoints to create a natural sounding dialogue with multiple speakers.

      Visit the following resources for more information:

      * [Eleven v3 overview](https://elevenlabs.io/v3)
      * [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3)
    </td>
  </tr>

  <tr>
    <td>
      #### Can I change the pace of the voice?

      Voice speed control is available for Text to Speech via Speech Synthesis, Studio, ElevenAgents and our API.

      You can control the speed of the voice using the Speed setting.

      Possible values range from 0.7 to 1.2. Values below 1 will slow the speech down, and values above 1 will speed it up. Extreme values may affect the quality of the generated speech.

      This setting is available for all voices and all models. You can find it in the voice settings.

      ![](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/a1130594e85e35a2a3073530577fd85e902b7886cbf442a18b4422d9084dfcec/assets/images/help-center/product/core-capabilities/text-to-speech/can-i-change-the-pace-of-the-voice.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=90ff83b9bd0bc060aff431f6244320911c1a05121b89f3b42f0687fdcfb516ea&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

      For information on how to control speech when using the API, please see our [API reference.](/docs/api-reference/text-to-speech/convert#request.body.voice_settings.speed)
    </td>
  </tr>

  <tr>
    <td>
      #### Can I use the same cloned/designed voice across languages?

      Any voice can speak any of the supported languages.

      The way the current model works is that you don't select a specific language, you instead write in the language you want the AI to speak and the AI understands automatically. However, since there can be some overlap between different languages where they use similar words and vocabulary but with quite different pronunciations and accents, you should use a cloned voice that was cloned speaking the language with the correct accent.

      The language is determined by the text, the accent and pronunciation is determined by the voice itself. It needs both of these contexts to function optimally.

      We are looking into developing new technology to facilitate the selection of language, but the way the AI is built means that all of this is still in progress.
    </td>
  </tr>

  <tr>
    <td>
      #### How do I download generated files from Text to Speech?

      You can download the generated files in two ways:

      You can download a generated file immediately by clicking the download button on the bottom right after generating the content.

      Previously generated files can be downloaded from your history.

      To access your history, log in to your account and select **Text to Speech** in the sidebar, then access your history by clicking the history tab in the panel on the right side of the screen. On narrow screens, you can access your history by clicking the history icon above the **Generate speech** button.

      From your history, you can click the download icon to see the option to download as either an MP3 (128kbps) or WAV file.

      You can also click **Advanced** to download in additional file formats:

      * MP3 (192kbps)
      * MP3 (256kbps)
      * M4A
      * FLAC
    </td>
  </tr>

  <tr>
    <td>
      #### Can you make voices produce the sound of breathing?

      Yes. With Eleven v3, you can use audio tags such as `[sighs]` or `[exhales]` to add breathing and similar reactions to generated speech.

      See the [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3) for more detail on audio tags and delivery control.
    </td>
  </tr>

  <tr>
    <td>
      #### Do you offer an AI model for conversational purposes or for chatbots?

      Our Flash and Turbo models have been specially developed for low-latency applications.

      Flash v2 and Flash v2.5 are our ultra-low-latency models, generating audio in less than 75ms. Flash v2 is English only, while Flash v2.5 supports 32 languages. You can see a full list of all supported languages
      [here](/docs/help-center/other/what-languages-do-you-support).

      Our Turbo models are also low-latency, but as the Flash models give very similar results, we recommend using the Flash models over Turbo. Turbo v2 is English only, while Turbo v2.5 supports 32 languages, and is 25% faster than Turbo v2, generating audio in around 300ms.

      Both Flash and Turbo are highly optimized models, specifically tailored for low-latency applications without sacrificing vocal performance and keeping inline with the quality standard that people have come to expect from our models.

      Both models are discounted when you generate via API. For details, see our API Pricing.

      We also offer ElevenAgents, our platform for deploying customized, interactive voice agents. Visit our ElevenAgents documentation to learn more.
    </td>
  </tr>

  <tr>
    <td>
      #### How can I add pauses?

      There are a few ways to introduce a pause or break and influence the rhythm and cadence of the speaker. The method you use depends on the model.

      ## Audio tags (Eleven v3 only)

      With Eleven v3, use audio tags and punctuation to control pacing and delivery. Eleven v3 does not support SSML break tags.

      See the [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3) for guidance on prompting pauses and delivery with v3.

      ## Break tags (Multilingual v2, Flash v2, and Flash v2.5)

      The most consistent way to add a pause on Multilingual v2, Flash v2, and Flash v2.5 is with the SSML break tag syntax `<break time="1.5s" />`. This creates an exact and natural pause in the speech. It is not just inserted silence between words—the model understands the syntax and adds a natural pause.

      How the model handles these pauses can vary. The voice used plays a pivotal role in the output. Some voices, those trained with a few "uh"s and "ah"s, may insert those vocal mannerisms during pauses, like a real speaker might.

      An example could look like this:

      "Give me one second to think about it." `<break time="1.0s" />` "Yes, that would work."

      Break time should be described in seconds. The AI can handle pauses of up to 3 seconds and can be used in Text to Speech and via the API.

      If you use an excessive number of SSML breaks in your text, it might cause issues. The speech might speed up, or the audio might introduce more noise and other artifacts. We are working on resolving this.

      ## Punctuation

      These options are less consistent than break tags or audio tags, but can still influence pacing.

      A simple dash `-` or the em-dash `—` often works well. You can add multiple dashes such as `-- --` for a longer pause.

      "It - is - getting late."

      Ellipsis `...` can sometimes add a pause between words, but it usually also adds some hesitation or nervousness to the voice that might not always fit.

      "I... yeah, I guess so..."
    </td>
  </tr>

  <tr>
    <td>
      #### How can I force a certain pronunciation of a word or name?

      Eleven v3 includes native support for International Phonetic Alphabet (IPA). Learn more in [IPA with Eleven v3](/docs/overview/capabilities/text-to-speech/best-practices#ipa-with-eleven-v3).

      ## SSML phoneme tags (Flash v2 and Turbo v2 only)

      On Flash v2 and Turbo v2, you can force a certain pronunciation with SSML phoneme tags. We support both IPA and CMU. CMU tends to be a bit more predictable and consistent with the current implementation. You can find out more in our [pronunciation guide](/docs/overview/capabilities/text-to-speech/best-practices#pronunciation).

      ## Alternative spellings

      Alternatively, a workaround is to find an alternative spelling and write a word more phonetically. You can employ various tricks such as capital letters, dashes, apostrophes, or even single quotation marks around a single letter or letters.

      As an example, a word like "trapezii" could be spelt "trapezIi" to put more emphasis on the "ii" of the word.
    </td>
  </tr>

  <tr>
    <td>
      #### How do audio tags work with Eleven v3 (Alpha)?

      Eleven v3 supports audio tags, giving unprecedented control over your generated audio:

      * Emotions: `[curious]` `[crying]` `[mischievously]`
      * Delivery direction: `[whispers]` `[shouts]`
      * Human reactions: `[laughs]` `[clears throat]` `[sighs]`

      For more detailed information, see our [guide to prompting with Eleven v3](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3).

      You can generate using v3 via API using our [Create speech](/docs/api-reference/text-to-speech/convert) and [Stream speech](/docs/api-reference/text-to-speech/stream) endpoints by specifying model ID `eleven_v3`.

      You can also use our [Create dialogue](/docs/api-reference/text-to-dialogue/convert) and [Stream dialogue](/docs/api-reference/text-to-dialogue/stream) endpoints to create a natural sounding dialogue with multiple speakers.

      Visit the following resources for more information:

      * [Eleven v3 overview](https://elevenlabs.io/v3)
      * [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3)
    </td>
  </tr>

  <tr>
    <td>
      #### How do I download WAV, M4A and FLAC files?

      Files that you have generated using Text to Speech or Voice Changer can be downloaded as MP3, WAV, M4A or FLAC files. WAV, M4A and FLAC files need to be downloaded from your history.

      #### **How to download WAV files**

      Select either **Text to Speech** or **Voice Changer** in the sidebar, then access your history by clicking the history tab in the panel on the right side of the screen. On narrow screens, you can access your history by clicking the history icon above the **Generate speech** button.

      From your history, you can click the download icon to see the option to download as either an MP3 or WAV file.

      #### **How to download FLAC or M4A files**

      Select either **Text to Speech** or **Voice Changer** in the sidebar, then access your history by clicking the history tab in the panel on the right side of the screen. On narrow screens, you can access your history by clicking the history icon above the **Generate speech** button.

      From your history, you can click the download icon to see the option to download as either an MP3 or WAV file. To access additional file formats, including FLAC and M4A, click **Advanced** and select your preferred format.
    </td>
  </tr>

  <tr>
    <td>
      #### How do I select the language and accent?

      **Language when generating via the website**

      When you generate audio on the ElevenLabs website, our AI automatically detects the language based on the context of the text of your prompt. This means that it's best to avoid using multiple languages in a single prompt, as this can cause confusion about which language should be used. At the moment, it isn’t possible to specify a language when generating on the website.



      **Language when generating via API**

      If you generate audio through the API, you can manually specify the language of your prompt using the `language_code` parameter. This is an optional parameter that accepts ISO 639-1 language codes.

      This can be useful for short or ambiguous prompts, such as when the text includes only numbers. Specifying the language ensures the normalizer applies the correct rules for that language.

      For more information on normalization, see [this article. ](/docs/help-center/product/core-capabilities/text-to-speech/why-are-numbers-dates-symbols-and-acronyms-not-properly-pronounced-or-spoken-in-the-correct-language)



      **Accent**

      The accent that is used for your generation comes from the voice you're using. If you use a voice that hasn’t been trained on the language you’re generating, you may notice a slight accent from the voice’s original language.

      For the best results, we recommend using a voice that has been trained on audio in the language you’re generating, with your preferred accent. This helps the AI understand pronunciation and intonation more accurately.

      This is especially important for languages that are similar or share many common words. Choosing a voice trained on the correct language ensures that the AI uses the correct pronunciation and accent.

      You can:

      * **Create a cloned voice** using audio in your preferred language and accent.
      * **Browse the Voice Library** and use the search filters to find suitable voices that
        match your needs.

      ![](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/b3e4de803d69ffbd3aed314c2c5f9defa87d3d7fd6fc1931a4a02278041c1c43/assets/images/help-center/product/core-capabilities/text-to-speech/how-do-i-select-the-language-and-accent.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=4fec05f49c369ca1579f87edb5ca9ec02cecc58f7af7968164dbfe825d70a8c2&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)
    </td>
  </tr>

  <tr>
    <td>
      #### How much does it cost to generate using Eleven v3 (Alpha)?

      The cost of generating with Eleven v3 is 1 credit per character on the website. API generations are discounted - see [API pricing](https://elevenlabs.io/pricing/api) for details.

      Visit the following resources for more information:

      * [Eleven v3 overview](https://elevenlabs.io/v3)
      * [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3)
    </td>
  </tr>

  <tr>
    <td>
      #### How to make the voice laugh?

      With Eleven v3, you can use [audio tags](/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-alpha) such as `[laughs]` to add laughter and other reactions to generated speech. See the [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3) for more detail.

      For other models, emotional delivery depends on context, punctuation, and voice settings. See [How to produce emotions?](/docs/help-center/product/core-capabilities/text-to-speech/how-to-produce-emotions).
    </td>
  </tr>

  <tr>
    <td>
      #### How to produce emotions?

      The model is sensitive to the wider situation surrounding each utterance - it assesses whether something makes sense by how it ties to preceding and succeeding text. This zoomed-out perspective allows it to intonate longer fragments properly by overlaying a particular train of thought stretching multiple sentences with a unifying emotional pattern.

      Tips for producing emotions:

      * Context is key for generating specific emotions. If you input laughing or funny text, you might get a happy output. The same applies for anger, sadness, and other emotions — setting the context is key.
      * Punctuation and voice settings play the leading role in how the output is delivered.
      * Add emphasis by putting the relevant words or phrases in quotation marks.
      * For speech generated using a cloned voice, the speaking style in the samples you upload for cloning is replicated in the output. If the speech in the uploaded sample is monotone, the model will struggle to produce expressive output.

      With Eleven v3, you can also use [audio tags](/docs/help-center/product/core-capabilities/text-to-speech/how-do-audio-tags-work-with-eleven-v3-alpha) to control emotion and delivery more directly, for example `[happy]`, `[sad]`, `[angry]`, `[whispers]`, and `[laughs]`. See the [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3) for more detail.

      These tips help guide emotional delivery but do not guarantee a specific result.
    </td>
  </tr>

  <tr>
    <td>
      #### Is there a way to preview audio without losing quota before downloading?

      Unfortunately, at this time, we do not offer download-based deduction as an alternative to generation-based deduction. There is currently no way to preview generations without deducting quota.

      When you press 'Generate' on the website, you will be deducted credits since the servers need to spin up and the audio needs to be generated. There's no way to test or preview a voice using your own text without using credits.

      We do permit two free regenerations in Text to Speech via the website in the following circumstances:

      * The prompt (for Text to Speech) or file (for Voice Changer), voice and model remain the same. You can change the voice setting sliders.
      * The first generation was made less than two hours ago.
      * You haven't refreshed the page since generating the original audio.

      If this is the case, you will see 'Regenerate speech', and the number of free regenerations remaining will be displayed if you hover over the 'Regenerate speech' button:

      ![](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/9b75422ebf4bee357d8eb5384d30e03a3c4c5102f422cb87c22ff09c1bfe1c8d/assets/images/help-center/product/core-capabilities/text-to-speech/is-there-a-way-to-preview-audio-without-losing-quota-before-downloading.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=b3c16c139292749bf867e916cd37ad2aaf5fed031b657971cc523114056107bb&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

      Once your free regenerations have been used, the button will return to 'Generate speech', and the number of credits that will be used for the generation will be displayed:

      ![](https://fdr-prod-docs-files-public.s3.us-east-1.amazonaws.com/elevenlabs.docs.buildwithfern.com/72b5058ea9066fbad31cf1a38453ba35947cc7486eb06ded307d1ae13c1011d4/assets/images/help-center/product/core-capabilities/text-to-speech/is-there-a-way-to-preview-audio-without-losing-quota-before-downloading-2.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Content-Sha256=UNSIGNED-PAYLOAD&X-Amz-Credential=AKIA6KXJSKKNFOCF7G4B%2F20260906%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260906T165503Z&X-Amz-Expires=604800&X-Amz-Signature=523857bc055a1fce2a73a807c8d12817197885a8001cd0784ba1ce7c071ec9b3&X-Amz-SignedHeaders=host&x-amz-checksum-mode=ENABLED&x-id=GetObject)

      Free regenerations are only available in Text to Speech via the website. They are not available via the API.

      We are looking into whether there's a way for us to facilitate previews at this quality without raising prices or costs. We are also exploring ways to make the AI more controllable, so you don't have to preview and instead get the desired result, hopefully on the first try.
    </td>
  </tr>

  <tr>
    <td>
      #### What is Dialogue mode?

      Eleven v3 offers Dialogue mode, allowing you to generate dynamic multi-speaker conversations with natural pacing, that handle interruptions, shifts in tone, and emotional cues based on conversational context.

      Dialogue mode is available when you use multiple speakers via the website.

      We’ve also created new Text to Dialogue API endpoints for generating multi-speaker interactions. For more information, see our[ API documentation](/docs/capabilities/text-to-dialogue):

      * [Create dialogue](/docs/api-reference/text-to-dialogue/convert)
      * [Stream dialogue](/docs/api-reference/text-to-dialogue/stream)

      Visit the following resources for more information:

      * [Eleven v3 overview](https://elevenlabs.io/v3)
      * [Eleven v3 prompting guide](/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v3)
    </td>
  </tr>

  <tr>
    <td>
      #### What languages can the AI speak?

      Any voice can speak any language currently supported by the AI; however, if you do not use a voice that is native to the language you want the AI to speak, for example, you use a generated voice or a voice cloned speaking English, the AI might have a slight English accent or might drift in and out of similar languages.

      For a full list of all supported languages, please see this article: [What languages do you support?](/docs/help-center/other/what-languages-do-you-support)

      The way the current model works is that you don't select a specific language. Instead, you write in the language you want the AI to speak, and the AI understands automatically. However, since there can be some overlap between different languages where they use similar words and vocabulary but with quite different pronunciations and accents, you should use a cloned voice that was cloned speaking the language with the correct accent as this will ensure the AI has the most context for how to speak something and in what language.

      **The language is determined by the text, while the accent and pronunciation are determined by the
      voice itself.**

      We are looking into developing new technology to facilitate the selection of language, but the way the AI is built means that all of this is still in progress.
    </td>
  </tr>

  <tr>
    <td>
      #### What's the maximum amount of characters and text I can generate?

      In [Text to Speech](https://elevenlabs.io/app/speech-synthesis/text-to-speech), using the website, you can generate up to 5,000 characters in a single generation on any paid plan and up to 2,500 on all free plans.

      However, if you plan on generating longer-form content of more than a few thousand characters, we highly recommend using [Studio](https://elevenlabs.io/app/studio) which allows you to generate extremely long-form content such as books and novels very easily. You can read more about it [here](https://elevenlabs.io/docs/eleven-creative/products/studio).

      If you're generating using the API, the maximum length of input varies depending on which model you're using:

      **Text to Speech**

      Flash v2.5 - up to 40,000 characters (\~40 minutes of audio)

      Turbo v2.5 - up to 40,000 characters (\~40 minutes of audio)

      Flash v2 - up to 30,000 characters (\~30 minutes of audio)

      Turbo v2 - up to 30,000 characters (\~30 minutes of audio)

      Multilingual v2 - up to 10,000 characters (\~10 minutes of audio)

      **Voice Changer**

      Multilingual v2 - up to 10 minutes of audio
    </td>
  </tr>

  <tr>
    <td>
      #### Which voices in the voice library are native to a specific language?

      All pre-made voices and generated voices are English. This means that they might not have the correct accent or pronunciation when speaking other languages.

      In the voice library, under the professional category, you can find voices that the community has shared with us. These voices are their own [Professional Voice Clones](/docs/product-guides/voices/voice-cloning/professional-voice-cloning) of their voices. These voices generally have a language tag that indicates the language in which they were cloned, making them native to that language.  You can also use the language search filter to filter for specific languages.
    </td>
  </tr>

  <tr>
    <td>
      #### Why are numbers, dates, symbols and acronyms not properly pronounced or spoken in the correct language?

      Numbers, dates, symbols and acronyms can present a challenge to the AI, as there are often multiple ways that they could be delivered correctly. This can also depend on the language that is being used, for example, “11” could be read as "Eleven," but it could also be "Once" in Spanish or "Elf" in German.

      There are several ways you can ensure the correct delivery of numbers, dates, acronyms and symbols.



      **Write out fully, in words**

      For the best results, we recommend writing numbers, acronyms, dates and symbols fully, in words, in the way that you would like the AI to deliver them. This ensures that the AI has the most context so that it will provide the correct output. For example, for “\$100”, we would recommend writing either "a hundred dollars" or "one hundred dollars" to ensure you get the result you would like.



      **Using an LLM**

      If you are using a large language model to generate your text prompts, for example, when using [ElevenAgents](/docs/conversational-ai/overview), you can prompt the model to always write numbers, dates, symbols, and acronyms out in words in whichever way you would prefer them to be delivered by the AI.



      **Normalization**

      If you’re generating via the API, you can specify whether to apply text normalization using the `apply_text_normalization` parameter. Text normalization spells out numbers and dates to ensure better pronunciation  This option does add latency as the normalization process takes additional processing time.

      The`apply_text_normalization` parameter has three modes:

      * on, which means it is always applied
      * off, which means it is never applied
      * auto, which means that the AI will automatically decide when to apply text normalization

      You can also specify the language of your prompt using the `language_code`parameter. This is an optional parameter that accepts ISO 639-1 language codes.

      This can be useful for short or ambiguous prompts, such as when the text includes only numbers or symbols. Specifying the language ensures the normalizer applies the correct rules for that language.

      For more information, see our [API reference.](/docs/api-reference/introduction)

      Normalization is enabled by default when generating using Text to Speech via the website.

      In Studio, the default is for normalization to be automatically applied, meaning that the AI will decide when to apply text normalization. You can also set normalization to be always applied - this option is in **Project settings** under the **Advanced** tab.
    </td>
  </tr>

  <tr>
    <td>
      #### Why is my voice mispronouncing certain words?

      Mispronunciations can happen for a few different reasons. The most common one is that the word is just misspelled. The AI will not try to correct any words that are misspelled, and it will try to read them exactly as they are written. So it's important to double-check and make sure that the text is proofread and finished before having the AI read it.

      If you want to force a certain pronunciation, you can use SSML phoneme tags with our Flash v2 model. You can find out more about this in our [pronunciation guide](/docs/overview/capabilities/text-to-speech/best-practices#pronunciation).

      Sometimes, the AI might mispronounce words or have a strange accent that is not the one you are expecting. This can happen for a few reasons, and in most cases, it's very voice-dependent and language-dependent. The best way to ensure the correct accent and pronunciation is to clone a voice with the correct accent and pronunciation. This will give the AI the most context when generating the audio.

      The language is specified by the text, and the accent is specified by the voice. So if you're writing in a language that might share a lot of common words or is fairly closely related to another language, the AI might have a hard time understanding how to pronounce certain words or switch between accents.

      However, under certain circumstances, the AI might mispronounce words that are written correctly, even in English. This seems to be highly dependent on the voice used and the text used, but should be a rare occurrence.
    </td>
  </tr>
</tbody>