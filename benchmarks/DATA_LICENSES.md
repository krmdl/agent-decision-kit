# Benchmark data licenses

The application source code, scripts, and original fixtures in this repository are licensed under Apache-2.0.

The `decision-boolq-validation-*.json` reports contain row IDs and answer labels derived from the Google BoolQ validation split. The BoolQ dataset card identifies that data as CC BY-SA 3.0 and cites Clark et al. (2019). Those reports are provided under CC BY-SA 3.0 with the attribution in their `sourceDataset` metadata; this notice does not change the license of the application code.

The full BoolQ passages and questions are downloaded at a pinned revision for local evaluation and are not committed to this repository or included in the result reports. The reproduction adapter verifies the parquet SHA-256 and uses the entire validation split.

- Dataset card and license: <https://huggingface.co/datasets/google/boolq>
- Paper: Clark et al. (2019), “BoolQ: Exploring the Surprising Difficulty of Natural Yes/No Questions,” NAACL, <https://aclanthology.org/N19-1300/>
- License: <https://creativecommons.org/licenses/by-sa/3.0/>
