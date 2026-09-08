> For the complete documentation index, see [llms.txt](https://docs.vocu.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.vocu.ai/generate/config.md).

# Generation Configuration

After completing content editing, you can click the gear icon in the function area to adjust generation configuration.

<figure><img src="/files/oJyuoGNdy4BOZ63PRX6c" alt=""><figcaption></figcaption></figure>

(Mobile version also uses gear icon)

**Generation parameters** have a great impact on the final generation effect. Currently, based on various tests and optimizations, we have set different preset templates, each corresponding to different optimization directions. You can choose different generation parameters by adjusting presets to find the most suitable effect for you.

<figure><img src="/files/MkPCaASC8V6yC3rkmZKl" alt=""><figcaption></figcaption></figure>

<figure><img src="https://github.com/VocuAI/Reecho-Docs/blob/main/en/.gitbook/assets/image%20(8).png" alt="" width="563"><figcaption></figcaption></figure>

{% hint style="info" %}
The generation preset parameters we prepared can handle text and timbre content in most cases. You can first try using the default parameters for generation. If the effect still does not meet expectations after switching presets multiple times, you can try testing with official characters to see if it is caused by poor samples of the voice character. You can also contact our support service for help.
{% endhint %}

<details>

<summary>Manually Adjustable Generation Settings</summary>

* **Presets:** Used to control the performance strategy adopted by the voice during generation, determining the basic expressiveness of the voice in hearing. Different generation presets focus on different parameter directions and can determine the understanding and expressiveness between the output voice and the text (for example, using the balanced preset, the voice will balance pronunciation performance and text understanding performance, fit the understanding of content, while using the creative preset, the voice will show a more performance-oriented pronunciation method based on the context of the text, and will have relatively unique effects when dealing with different scenarios.)
* **Emotion Style:** For the content input during generation, different style tendencies will optimize and restore different detail parts during processing. When selecting text-oriented, the result details will be improved according to the semantics of the input text, more in line with the text context; when selecting character-oriented, more attention will be paid to restoring the direct expressiveness of the voice character sample.
* **Generation Seed**: Controls the randomness during generation. The same seed will produce similar results during generation. This value can be an integer from 1 to 2147483647. The default setting of -1 is completely random. Usually no adjustment is needed.
* **Speech Rate**: Controls the speed of generated speech. The larger the value, the faster the speech speed. It can be adjusted to a value between 0.5x and 2x, with 1 being normal speed.

</details>

<details>

<summary>Unique Configuration Added in V3.0 Series Models</summary>

**In the V3.0 series model, we have added some unique parameters. Paragraphs assigned with V3.0 model characters can additionally control the following settings:**

* **Language:** Specify the language of the content in the paragraph. By default, the system can automatically recognize the language of the input content. If the recognition is not accurate enough or the language you input is Cantonese, please manually select the language. (Currently cannot automatically recognize Cantonese content)
* **Vivid Expression:** Support enabling the "Vivid Expression" option for individual paragraphs. When enabled, the model will expand the expressive range based on the understanding of the content, making the sentences more expressive and infectious (best effect for Japanese ASMR), but may reduce generation stability.
* **Emotion Control:** This function parameter allows you to adjust the emotional tendency of paragraph pronunciation. After enabling this function, you can manually specify emotion ratios, including angry, happy, neutral, sad, and matching context. The model will try to pronounce with corresponding emotional expressions according to the set ratio. The specific effect may vary greatly for different samples and may reduce generation stability.
* **Consistency Optimization**: **Experimental feature**, when enabled, it will optimize the generation effect of long content gathered in a single paragraph, improve consistency and coherence, but may reduce expressiveness. For text content editing, you can refer to [Text Content Editing](https://docs.vocu.ai/zh/~/revisions/UXeoxR8p2d7pY0hBgCpM/generate/text-edit) for more information.
* **Post-processing Mode: Experimental feature,** this item controls the output optimization strategy. By default, it will optimize for the restoration of character voice. In addition, different options can adjust the auditory performance of the final audio. You can try to adjust this setting according to your needs.

</details>

After the parameter settings are completed, close the configuration popup. Just click the **Start Generation** button in the function area to submit the speech generation task. After the task is submitted, the system will start the generation task. You can watch the generation progress on the main interface and start playback after completion.
