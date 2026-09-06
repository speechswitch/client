> For the complete documentation index, see [llms.txt](https://docs.vocu.ai/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.vocu.ai/introduction/models.md).

# Model Introduction

Our **VOCU Voice Large Model** has been pre-trained on massive amounts of Chinese and multilingual audio, covering various types of content, but most notably **audiobooks** and **regular conversational audio**. If your cloned audio samples and target text are of these types, you will typically achieve better results when generating speech. Our model will try to mimic the **tone, speed, emotion, pauses, loudness, acoustic environment, breathing sounds, accent, and vocalization** characteristics of the cloned audio samples, understand the context of the target text as much as possible, and synthesize them to produce the most matching speech.

## VOCU Voice Synthesis Large Model V3.1 <a href="#v2.9" id="v2.9"></a>

<sub>*Released on December 6, 2025, V2 series characters can be manually upgraded to V3 model*</sub>

> 💡 Upgrade Tips: Characters from the previous V3.0-Alpha version have been automatically upgraded to this version. V2.X characters need to be **manually upgraded** to this new version via the "Actions" menu on the details page. If you experience longer wait times when generating for the first time after upgrading an existing character, it's usually because the system is automatically upgrading that character - please be patient.

Compared to the V3.0-Alpha beta, this version introduces brand new **professional cloning** and **voice conversion capabilities**, with **comprehensive improvements across all scenarios and languages** in **emotional expressiveness, stability, similarity, naturalness, and semantic perception**, delivering even more impressive audio generation results.

Compared to earlier versions like V2, the new **V3 series** speech synthesis model brings full support for **over 30 languages and dialects worldwide**, with **significantly leading performance** against global competitors in **emotional intensity, similarity, stability, naturalness, and semantic understanding**, achieving cinema-grade performance.

#### 🎓 New **Professional Voice Cloning** Capability Now Available

You can provide voice samples ranging from **just a few dozen seconds to several hours**, and our model will **deeply train and learn** every **intonation, pronunciation style, rhythm, prosody, vocal habits, and other details** from your voice samples, achieving top-tier cloning synthesis effects that are **indistinguishable from the original voice**.

#### 🎤 New **Voice Conversion** Capability Now Available

You can now **convert the timbre of any audio to the voice you need**, enabling **precise control** over voice performance details - one person can voice multiple characters. Additionally, voice conversion is **seamlessly compatible with all existing voice characters** and supports **converting singing voices**, enabling song covers and related creative work.

#### 🧠 Comprehensive Core Model Capability Improvements

Compared to the **V3.0-Alpha** beta, V3.1 generates audio with **stronger emotional expressiveness, stability, similarity, naturalness, and semantic perception** across **all scenarios, languages, texts, and characters**, taking your voice creation and applications to the next level.

#### 🔧 Product Experience Updates And Fixes

Besides model updates, we have also made **comprehensive improvements** to the product experience during this period, including but not limited to **numerous UI design improvements and usability refactoring, performance optimizations, and bug fixes**.

Due to the large number of changes and limited space, we hope you will experience them directly while using the product, and we hope you will enjoy all the new content we have brought to you.

## VOCU Voice Large Model V3.0-Alpha <a href="#v2.9" id="v2.9"></a>

<sub>*Released on August 26, 2025, V2 series characters can be manually upgraded to V3 model*</sub>

Vocu Voice Large Model V3.0-Alpha is our new cross-version release. As an early public beta version of a new phase, it brings multiple functional updates and capability enhancements, further expanding the expressiveness of voice content generation. Specific updates are as follows:\\

* In V3 version, **multilingual samples and cross-language generation capabilities** are available. In addition to the early-achieved Chinese-English cross-language capability, we have added support for Cantonese, Japanese, Korean, French, German, Spanish and Portuguese, as well as more than 30 accent variants of these languages. The model can now directly process input and output of these languages.

*(It should be noted that cross-language generation may be affected by sample pronunciation. When using this function, it is recommended to use clear and corresponding language speech to get the best results.)*

* **Expressiveness and Naturalness Enhancement**, significantly enhanced in multiple dimensions including emotional tension, similarity, stability, naturalness, and semantic understanding ability. New support for various complex forms of expression, including roaring, rap, coquettish, ASMR, etc., can also be generated in extreme emotions and delicate expressions.
* Added **Vivid Expression** optimization, supporting individual paragraphs to enable the "Vivid Expression" option separately. When enabled, the model will automatically adjust speech details based on the understanding of content, making sentences more expressive and infectious. (May cause unstable results for some samples)
* Added **Emotion Ratio Control** optimization, supporting setting emotional expression ratios for individual paragraphs, allowing sentences to present clearer emotional tendencies during generation, such as anger, happiness, sadness, etc. By flexibly controlling emotional weights, model output will have richer emotional layers.
* **Background Acoustic Feature Replication Optimization**, sample replication capability greatly improved. It is not limited to vocal features, but can also intelligently restore **background acoustic features**, including spatial sense, reverberation, volume, etc., making the generated content closer to the original voice texture of the character.

## VOCU Voice Large Model V2.9 <a href="#v2.9" id="v2.9"></a>

*Released on March 1, 2025, **currently the latest version of the V2 series model**, previous V2.X characters have been automatically upgraded to this compatible version*

The latest version of Vocu Voice Large Model, this version introduces a large number of functions and improvements from the V3 version model under development. In Chinese voice content generation performance, it has reached **global SOTA level**, compared to previous versions, the update content is as follows:

* Greatly improved the generated audio quality **under non-Flash models (i.e. high-quality mode)**, and solved the long-standing problem of electric current edging in generation results.
* Greatly improved character similarity and character stability **under non-Flash models (i.e. high-quality mode)**, and can largely restore the acoustic environment of the character's original audio sample (such as spatial sense, reverberation, volume, recording texture, etc.).
* Added the world's first character timbre mixing capability, which can freely specify audio samples of multiple different characters and freely mix them according to proportion to create a brand new character timbre. ***(In internal testing, will be gradually opened)***
* Added the world's first character style mixing capability. When creating a new emotional style, you can specify style samples and character samples separately for fusion to create a new character emotional expression; for example, you can fuse the style of a cross-talk performer with a little girl character to create a new emotional expression for this little girl character when performing cross-talk. ***(In internal testing, will be gradually opened)***
* Added a new **zero-threshold** character intelligent dubbing/cover capability, which can directly let the specified existing character re-dub the completed generation results, or dub or cover any voice or song audio content you provide, and retain many style characteristics of the character during this process, bringing you a freer new audio creation experience. ***(In internal testing, will be gradually opened)***

Currently, the generation point consumption of this version model character is **`1 point/character`**

## VOCU Voice Large Model V2.5 <a href="#v2.5" id="v2.5"></a>

*Released on November 26, 2024, **deprecated**, corresponding characters have been automatically upgraded to the latest version of the V2.X series*

The second official version of our V2.X series voice large model. This version introduces new hyperparameters and training strategies. Compared with previous versions, it further improves the naturalness, rhythm and emotional expression of generation results, and to a certain extent improves character similarity, long-form content stability, and English content generation performance.

## VOCU Voice Large Model V2.1 <a href="#v2.1" id="v2.1"></a>

*Released on August 16, 2024, **deprecated**, corresponding characters have been automatically upgraded to the latest version of the V2.X series*

The first official version of our V2.X series voice large model. This version has greatly improved in terms of natural emotional expressiveness, generation effects, stability, instant cloning similarity and other effects compared to previous versions, and brings faster generation speed and higher audio quality, improved English generation effects, and improved and added the following capabilities:

* **Dialect Support:** Thanks to Vocu's super strong vocal understanding ability, we can now provide preliminary support for some types of dialect accents, including Henan dialect, Northeast dialect, Chongqing dialect and other Mandarin dialects and a few non-Mandarin pronunciations.
* **Low Latency Playback:** The V2.1 version Flash model now supports starting playback of generation results within 1 second, unlimited text length, meeting various low-latency real-time needs. When using the web version, select "Low Latency Mode".
* **More Refined Instant Cloning Capability:** In instant cloning mode, V2.1's understanding of longer samples has improved 4 times compared to V1.0 version, and can more deeply imitate various expressions contained in longer samples.
* **Better Long Context Understanding Capability:** V2.1 version's understanding ability for longer generated text has improved 3 times compared to V1.0 version, can understand more text at once, and generate more fitting and coherent voice performance.
* **Websocket Millisecond Generation:** We have added a new Websocket generation channel for developers, which can realize streaming generation requests and result returns, and the generation delay can be as low as 500ms, which is enough to meet various high real-time needs.
* **Faster Professional Cloning Speed:** The time required for professional cloning has been greatly shortened. For a 30-minute sample, cloning tasks can be completed within 3-5 minutes.

## VOCU Voice Large Model V2.0Beta-3 <a href="#v2.0-beta-3" id="v2.0-beta-3"></a>

*Released on July 8, 2024, **deprecated**, corresponding characters have been automatically upgraded to the latest version of the V2.X series*

The third beta version of our V2.X series voice large model. Compared to the second beta version, it has the following improvements:

* The problem of electric current noise has been greatly improved. Now for most timbre samples, obvious electric current sound should be imperceptible
* Stability has been greatly improved. Now the single generation stability performance for long and complex content should be greatly improved
* Emotional rhythm performance has been greatly improved. Now for non-overly flat sample emotional performance should be significantly improved. It is recommended to use with text containing mood words and colloquial expressions for the best experience
* English performance has been greatly improved, and is basically in a usable state now
* Flash model streaming generation latency reduced by 50%+. When resources are sufficient, playable generation results can be obtained within 500ms - 1 second
* Adopting new technical strategies, concurrent carrying capacity has been greatly improved, which should effectively improve the congestion problem caused by the recent increase in usage

For detailed update content compared to V1.0 version, please refer to the V2.1 official version introduction.

## VOCU Voice Large Model V2.0Beta-2-Flash <a href="#v2.0-beta-2-flash" id="v2.0-beta-2-flash"></a>

*Released on June 25, 2024, **deprecated with V2.0Beta-2**, subsequent versions all include corresponding Flash models*

The first low-latency Flash branch version of Vocu Voice Large Model, derived from V2.0Beta-2 and mutually compatible, brings a low-latency streaming playback experience during generation, but the audio quality will be somewhat lower compared to the main model. When resources are sufficient, content of any length through this Flash model version can start listening to generation results within 1-2 seconds after submitting the task.

## VOCU Voice Large Model V2.0Beta-2 <a href="#v2.0-beta-2" id="v2.0-beta-2"></a>

*Released on June 18, 2024, **deprecated**, corresponding characters have been automatically upgraded to the latest version of the V2.X series*

The second beta version of our V2.X series voice large model. Compared to the first beta version, it has further improvements in stability, usability, audio quality and other aspects. For detailed update content compared to V1.0 version, please refer to the V2.1 official version introduction.

## VOCU Voice Large Model V2.0Beta-1 <a href="#v2.0-beta-1" id="v2.0-beta-1"></a>

*Released on June 10, 2024, **deprecated**, corresponding characters have been automatically upgraded to the latest version of the V2.X series*

The first beta version of our V2.X series voice large model. The generation effect, stability, instant cloning similarity, generation speed and audio quality of this version have been greatly improved compared to V1.0 version, but there are still many problems at this time. For detailed update content compared to V1.0 version, please refer to the V2.1 official version introduction.

## VOCU Voice Large Model V1.0 <a href="#v1.0" id="v1.0"></a>

*Released on January 11, 2024, **now stopped maintenance**, does not support creating new V1.0 characters; existing V1.0 instant cloning characters can continue to generate or upgrade to V2.X version with one click.*

Our first officially released model version, can understand text context to a certain extent, and generate vocal audio based on text with expressiveness, emotion, rhythm and timbre almost indistinguishable from real people, and supports instant voice cloning with very short samples. This version of the model also brings experimental support for English speech synthesis and cloning, but currently the stability and expressiveness may be worse compared to Chinese.

Currently, the point consumption of this model is `1 point/character`.

## VOCU Voice Large Model V0.9Beta <a href="#v0.9" id="v0.9"></a>

*Released in November 2023, **deprecated**, corresponding characters have been automatically upgraded to the latest version of the V1.X series*

Our first publicly released experimental voice large model, and also **the world's first generative voice large model with Chinese localized natural expression**. This model can generate speech with near-human speed, tone and intonation, and can better imitate changes in emotions, making AI closer to humans, and supports instant voice cloning technology. Currently only supports Chinese.

This version of the voice model **(V0.9)** is still in the early testing stage and has many known issues.
