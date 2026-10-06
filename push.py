from pathlib import Path
import os
import argparse

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("message", type=str, nargs="?", default="Initial commit")
    args = parser.parse_args()

    token = Path('token.txt').read_text()
    cmd = f'git config --global user.name "p2perrault" \
    && git config --global user.email "p2perrault@gmail.com" \
    && git init . \
    && git branch -M master \
    && git add . \
    && git commit -m "{args.message}" \
    && git push --force https://{token}@github.com/p2perrault/manim-vscode.git'
    os.system(cmd)




