"""Download the public datasets into data/raw/ (no account needed).

    python -m src.download_data
"""

import io
import urllib.request
import zipfile

from .paths import RAW

# folder → files; a .zip URL is extracted, anything else is saved under the given name.
DATASETS = {
    "s2d": {"s2d.zip": "https://www.kaggle.com/api/v1/datasets/download/niyarrbarman/symptom2disease"},
    "dsp": {
        "dsp.zip": "https://www.kaggle.com/api/v1/datasets/download/itachi9604/disease-symptom-description-dataset"
    },
    # DDXPlus (figshare article 22687585). The validation split (132k
    # patients) is plenty: prepare.py samples 60 per condition.
    "ddxplus": {
        "release_evidences.json": "https://ndownloader.figshare.com/files/40278013",
        "release_validate_patients.zip": "https://ndownloader.figshare.com/files/40278022",
    },
}


def main() -> None:
    for folder, files in DATASETS.items():
        target = RAW / folder
        if target.exists() and any(target.iterdir()):
            print(f"{folder}: already present, skipping")
            continue
        target.mkdir(parents=True, exist_ok=True)
        for name, url in files.items():
            print(f"{folder}: downloading {name} ...")
            with urllib.request.urlopen(url, timeout=600) as response:
                content = response.read()
            if name.endswith(".zip"):
                archive = zipfile.ZipFile(io.BytesIO(content))
                archive.extractall(target)
                print(f"{folder}: {', '.join(archive.namelist())}")
            else:
                (target / name).write_bytes(content)


if __name__ == "__main__":
    main()
