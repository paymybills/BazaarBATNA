"""Entry point for multi-mode deployment."""

import uvicorn

from server.main import app  # noqa: F401


def main():
    uvicorn.run("server.main:app", host="0.0.0.0", port=8000)


if __name__ == "__main__":
    main()
