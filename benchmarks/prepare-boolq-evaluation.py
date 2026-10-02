#!/usr/bin/env python3
"""Download a pinned BoolQ validation split and emit local decision fixtures."""
import argparse
import hashlib
import json
import sys
import urllib.request
from io import BytesIO
from pathlib import Path


DATASET_ID = "google/boolq"
DATASET_REVISION = "35b264d03638db9f4ce671b711558bf7ff0f80d5"
DATASET_SPLIT = "validation"
DATASET_LICENSE = "CC-BY-SA-3.0"
DATASET_FILE_SHA256 = "52355d11524b4b874a9b9dcc278feb10f672d52c4f4eff9872e695ede59820f8"
DATASET_FILE_URL = (
    "https://huggingface.co/datasets/google/boolq/resolve/"
    f"{DATASET_REVISION}/data/validation-00000-of-00001.parquet"
)
EXPECTED_ROWS = 3270


def load_validation_rows():
    try:
        import pyarrow.parquet as parquet
    except ImportError as error:
        raise SystemExit("This benchmark adapter needs pyarrow; install it with `python -m pip install pyarrow`.") from error

    request = urllib.request.Request(
        DATASET_FILE_URL,
        headers={"User-Agent": "agent-decision-kit BoolQ benchmark"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        parquet_bytes = response.read()
    digest = hashlib.sha256(parquet_bytes).hexdigest()
    if digest != DATASET_FILE_SHA256:
        raise SystemExit(f"BoolQ parquet SHA-256 mismatch: expected {DATASET_FILE_SHA256}, got {digest}")

    rows = parquet.read_table(BytesIO(parquet_bytes), columns=["question", "answer", "passage"]).to_pylist()
    if len(rows) != EXPECTED_ROWS:
        raise SystemExit(f"BoolQ validation row count mismatch: expected {EXPECTED_ROWS}, got {len(rows)}")
    for index, row in enumerate(rows):
        if not isinstance(row.get("question"), str) or not row["question"].strip():
            raise SystemExit(f"BoolQ row {index} has no question text")
        if not isinstance(row.get("passage"), str) or not row["passage"].strip():
            raise SystemExit(f"BoolQ row {index} has no passage text")
        if not isinstance(row.get("answer"), bool):
            raise SystemExit(f"BoolQ row {index} does not have a boolean answer")
    return rows


def fixture_records(rows, selection, row_indices):
    source_dataset = {
        "id": DATASET_ID,
        "revision": DATASET_REVISION,
        "split": DATASET_SPLIT,
        "rowCount": EXPECTED_ROWS,
        "license": DATASET_LICENSE,
        "datasetCard": "https://huggingface.co/datasets/google/boolq",
        "parquetUrl": DATASET_FILE_URL,
        "parquetSha256": DATASET_FILE_SHA256,
        "citation": "Clark et al. (2019), BoolQ: Exploring the Surprising Difficulty of Natural Yes/No Questions, NAACL.",
        "selection": selection,
        "textHandling": "Passage/question text is used only in the local temporary fixture and is not written to the benchmark result.",
    }
    if len(row_indices) != len(rows):
        raise ValueError("row_indices must have the same length as rows")
    for row_index, row in zip(row_indices, rows):
        yield {
            "id": f"boolq-validation-{row_index:04d}",
            "state": f"Passage:\n{row['passage']}",
            "question": {
                "type": "noul",
                "instructions": f"Using only the passage, answer this yes/no question: {row['question']}",
            },
            "expected": row["answer"],
            "sourceDataset": source_dataset,
        }


def select_rows(rows, sample_size):
    if not rows or not 1 <= sample_size <= len(rows):
        raise ValueError(f"sample_size must be between 1 and {len(rows)}")
    if sample_size == len(rows):
        return rows, "Every row in the pinned validation split; no resampling or dropped examples.", list(range(len(rows)))
    indexes = [
        0 if sample_size == 1 else round(index * (len(rows) - 1) / (sample_size - 1))
        for index in range(sample_size)
    ]
    selected_rows = [rows[index] for index in indexes]
    selection = (
        f"{sample_size} evenly spaced row indices from the pinned {len(rows)}-row validation split, "
        "selected for instrumentation."
    )
    return selected_rows, selection, indexes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path, help="Temporary JSONL fixture output path")
    parser.add_argument(
        "--sample-size",
        type=int,
        default=EXPECTED_ROWS,
        help="Use every validation row by default; optionally select this many evenly spaced rows for instrumentation",
    )
    args = parser.parse_args()
    if not 1 <= args.sample_size <= EXPECTED_ROWS:
        parser.error(f"--sample-size must be between 1 and {EXPECTED_ROWS}")
    rows = load_validation_rows()
    try:
        rows, selection, row_indices = select_rows(rows, args.sample_size)
    except ValueError as error:
        parser.error(str(error))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as output:
        for record in fixture_records(rows, selection, row_indices):
            output.write(json.dumps(record, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"Prepared {len(rows)} pinned BoolQ validation examples at {args.output}; source text was not printed.")


if __name__ == "__main__":
    main()
