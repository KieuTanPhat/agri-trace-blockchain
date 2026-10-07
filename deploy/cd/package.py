#!/usr/bin/env python3
"""Create a small public deployment bundle from exact committed Git bytes."""
import argparse
import io
import json
import subprocess
import tarfile
from pathlib import Path
from policy import SHA, allowed_file, fingerprint, require, sha256, validate_manifest


def package(sha, api, web, repository, origin, dist, output):
    require(bool(SHA.fullmatch(sha)), "Invalid commit SHA")
    files = {}
    controller = {}
    raw = subprocess.check_output(["git", "archive", "--format=tar", sha])
    with tarfile.open(fileobj=io.BytesIO(raw)) as source:
        for member in source:
            if member.name in {f"deploy/cd/{name}" for name in ("controller.py", "policy.py", "verify.mjs", "entry")}:
                controller[member.name.split("/")[-1]] = sha256(source.extractfile(member).read())
            if member.isfile() and allowed_file(member.name) and not "/dist/" in member.name:
                files[member.name] = source.extractfile(member).read()
    for file in Path(dist).rglob("*"):
        if file.is_file():
            name = "blockchain/chaincode/dist/" + file.relative_to(dist).as_posix()
            require(allowed_file(name), "Unexpected compiled chaincode path")
            files[name] = file.read_bytes()
    hashes = {name: sha256(data) for name, data in sorted(files.items())}
    manifest = {"format": 1, "sha": sha, "repository": repository, "origin": origin,
                "api": api, "web": web, "files": hashes, "chaincode": fingerprint(hashes), "controller": controller,
                "migrations": {name.split("/")[-2]: digest for name, digest in hashes.items() if name.endswith("/migration.sql")}}
    validate_manifest(manifest, sha, repository, origin)
    files["cd-manifest.json"] = (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode()
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(output, "w:gz", compresslevel=6) as archive:
        for name, data in sorted(files.items()):
            member = tarfile.TarInfo(name)
            member.size = len(data)
            member.mode = 0o640
            member.mtime = 0
            archive.addfile(member, io.BytesIO(data))
    print(json.dumps({"sha": sha, "archiveSha256": sha256(Path(output).read_bytes()), "files": len(hashes)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("sha", "api", "web", "repository", "origin", "dist", "output"):
        parser.add_argument("--" + name, required=True)
    package(**vars(parser.parse_args()))
