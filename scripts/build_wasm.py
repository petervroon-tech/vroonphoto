#!/usr/bin/env python3
"""
build_wasm.py
Compiles vroonphoto_core.c to WebAssembly (vroonphoto_core.wasm).
Self-contained, cross-platform build script.
"""

import os
import subprocess
import sys

def encode_u32(val):
    res = bytearray()
    while True:
        b = val & 0x7f
        val >>= 7
        if val != 0:
            res.append(b | 0x80)
        else:
            res.append(b)
            break
    return bytes(res)

def build():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    c_src = os.path.join(root_dir, "src", "wasm", "vroonphoto_core.c")
    wasm_out = os.path.join(root_dir, "src", "wasm", "vroonphoto_core.wasm")
    obj_tmp = "/tmp/vroonphoto_core.o"

    print(f"[1/3] Compiling {c_src} with clang --target=wasm32...")
    cmd = [
        "clang",
        "-c",
        "--target=wasm32",
        "-O3",
        "-nostdlib",
        "-fno-builtin",
        c_src,
        "-o",
        obj_tmp
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print("Clang compilation failed:", res.stderr, file=sys.stderr)
        sys.exit(1)

    print("[2/3] Parsing WASM object sections and linking exports...")
    with open(obj_tmp, "rb") as f:
        data = f.read()

    sections = {}
    pos = 8
    while pos < len(data):
        sec_id = data[pos]
        pos += 1
        length = 0
        shift = 0
        while True:
            b = data[pos]
            pos += 1
            length |= (b & 0x7f) << shift
            if not (b & 0x80):
                break
            shift += 7
        payload = data[pos:pos+length]
        sections[sec_id] = payload
        pos += length

    out = bytearray(b"\x00asm\x01\x00\x00\x00")

    # 1. Type section
    type_payload = sections[1]
    out.append(1)
    out += encode_u32(len(type_payload))
    out += type_payload

    # 2. Function section
    func_payload = sections[3]
    out.append(3)
    out += encode_u32(len(func_payload))
    out += func_payload

    # 3. Memory section: min 256 pages (16MB), max 2048 pages (128MB)
    mem_payload = bytearray()
    mem_payload += encode_u32(1)
    mem_payload.append(1)
    mem_payload += encode_u32(256)
    mem_payload += encode_u32(2048)
    out.append(5)
    out += encode_u32(len(mem_payload))
    out += mem_payload

    # 4. Export section: export memory and functions
    funcs = [
        "vroon_recover_red_light",
        "vroon_denoise_bilateral",
        "vroon_denoise_chroma",
        "vroon_punchy_bw",
        "vroon_super_res_2x",
        "vroon_smart_inpaint"
    ]
    exp_payload = bytearray()
    exp_payload += encode_u32(1 + len(funcs))
    exp_payload += encode_u32(len("memory")) + b"memory" + bytes([0x02, 0x00])

    for idx, name in enumerate(funcs):
        bname = name.encode("utf-8")
        exp_payload += encode_u32(len(bname)) + bname + bytes([0x00]) + encode_u32(idx)

    out.append(7)
    out += encode_u32(len(exp_payload))
    out += exp_payload

    # 5. Code section
    code_payload = sections[10]
    out.append(10)
    out += encode_u32(len(code_payload))
    out += code_payload

    print(f"[3/3] Writing standalone WASM binary to {wasm_out} ({len(out)} bytes)...")
    os.makedirs(os.path.dirname(wasm_out), exist_ok=True)
    with open(wasm_out, "wb") as f:
        f.write(out)

    print("✅ Build complete: vroonphoto_core.wasm successfully generated!")

if __name__ == "__main__":
    build()

