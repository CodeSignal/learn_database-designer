# server.py (only the imports and do_POST change shown)
from http.server import SimpleHTTPRequestHandler
from socketserver import TCPServer
from urllib.parse import urlparse, parse_qs
import json
import os

PORT = 3000
ALLOWED_FILES = {"test.json", "solution.json"}

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if not self.path.startswith("/api/save"):
            self.send_response(404); self.end_headers(); return

        # which file to write?
        parsed = urlparse(self.path)
        target = parse_qs(parsed.query).get("file", ["test.json"])[0]
        if target not in ALLOWED_FILES:
            self.send_response(400); self.end_headers()
            self.wfile.write(b"Unsupported file name"); return

        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = self.rfile.read(length).decode("utf-8")
            data = json.loads(payload)  # validate JSON

            with open(target, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
                f.write("\n")

            self.send_response(200)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(f"ok: wrote {target}".encode("utf-8"))
        except json.JSONDecodeError:
            self.send_response(400); self.end_headers()
            self.wfile.write(b"Invalid JSON")
        except Exception as e:
            self.send_response(500); self.end_headers()
            self.wfile.write(f"Error: {e}".encode("utf-8"))

if __name__ == "__main__":
    with TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving on http://localhost:{PORT}")
        httpd.serve_forever()
