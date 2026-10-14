"""Merge tracked public settings with retained private runtime configuration."""
import sys
from pathlib import Path
from environment import load
from provision import private_write, read_runtime

try:
    config = load(sys.argv[1], require_connections=False)
    destination = Path(sys.argv[2])
    values = read_runtime(destination)
    values.update({key: value for key, value in config["runtime"].items() if value is not None})
    private_write(destination, "".join(f"{key}={value}\n" for key, value in sorted(values.items())))
except Exception:
    sys.exit("Cannot merge tracked runtime configuration (values suppressed)")
