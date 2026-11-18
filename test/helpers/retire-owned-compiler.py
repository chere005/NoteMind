"""Retire only a completed compiler child with its captured kernel identity."""
import ctypes, errno, json, os, signal, struct, sys, time

def identity(pid):
    lib = ctypes.CDLL('/usr/lib/libproc.dylib', use_errno=True)
    lib.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    lib.proc_pidinfo.restype = ctypes.c_int
    data = ctypes.create_string_buffer(136)
    count = lib.proc_pidinfo(pid, 3, 0, data, 136)
    if count == 0 or count != 136 and ctypes.get_errno() == errno.ESRCH:
        return None
    if count != 136 or struct.unpack_from('=I', data.raw, 12)[0] != pid:
        raise RuntimeError('Cannot verify compiler identity')
    return {'pid': pid, 'parent': struct.unpack_from('=I', data.raw, 16)[0], 'status': struct.unpack_from('=I', data.raw, 4)[0], 'birth': list(struct.unpack_from('=QQ', data.raw, 120))}

def main():
    mode, root = sys.argv[1], int(sys.argv[2])
    if sys.platform != 'darwin' or os.getppid() != root:
        raise RuntimeError('Compiler observer must be the fixture child')
    if mode == 'capture':
        children = [identity(int(pid)) for pid in sys.argv[3:]]
        children = [row for row in children if row is not None]
        if any(row['parent'] != root for row in children):
            raise RuntimeError('Compiler parent changed')
        return {'root': identity(root), 'children': children}
    owned = json.loads(sys.argv[3])
    current_root = identity(root)
    if current_root is None or current_root['birth'] != owned['root']['birth']:
        raise RuntimeError('Fixture identity changed')
    result = []
    for captured in owned['children']:
        pid, sent, deadline = captured['pid'], None, time.monotonic() + 5
        while True:
            current = identity(pid)
            if current is None:
                result.append({'pid': pid, 'actualExit': True, 'reaped': True})
                break
            if current['birth'] != captured['birth'] or current['parent'] != root:
                raise RuntimeError('Compiler identity changed before retirement')
            if current['status'] == 5:  # Darwin SZOMB: exited, awaiting parent reap.
                result.append({'pid': pid, 'actualExit': True, 'reaped': False})
                break
            if sent is None:
                os.kill(pid, signal.SIGTERM)
                sent = time.monotonic()
            elif time.monotonic() - sent > 1:
                os.kill(pid, signal.SIGKILL)
            if time.monotonic() >= deadline:
                raise RuntimeError('Completed compiler did not stop')
            time.sleep(.01)
    return {'children': result}

if __name__ == '__main__':
    print(json.dumps(main()))
