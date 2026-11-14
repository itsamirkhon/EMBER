import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("EMBER_DB", str(Path(tempfile.mkdtemp(prefix="ember-test-")) / "default.db"))
os.environ.pop("OPENAI_API_KEY", None)
