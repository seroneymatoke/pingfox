"""Flask entrypoint for Vercel.

Vercel imports ``app`` from this module and exposes it under ``/api``.
Local development uses the same application factory through Flask's CLI.
"""

from api.app import create_app

app = create_app()
