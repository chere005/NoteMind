"""Test-only macOS owned-tree guard; never reads commands, paths or process content."""
import ctypes, errno, json, os, signal, struct, subprocess, sys, time

LIMIT = 1024 ** 3
MAX_ROWS = 2400

def parse_rows(output):
    result = []
    for line in output.splitlines():
        fields = line.split()
        if len(fields) != 3 or not all(value.isdigit() for value in fields):
            raise ValueError("Invalid numeric process snapshot")
        pid, ppid, rss = map(int, fields)
        if pid < 1:
            raise ValueError("Invalid numeric PID")
        result.append({"pid": pid, "ppid": ppid, "rssKiB": rss})
    return result

def descendants(rows, root_pid):
    if len({row["pid"] for row in rows}) != len(rows):
        raise ValueError("Duplicate PID in process snapshot")
    owned = {root_pid}
    changed = True
    while changed:
        changed = False
        for row in rows:
            if row["ppid"] in owned and row["pid"] not in owned:
                owned.add(row["pid"])
                changed = True
    return [row for row in rows if row["pid"] in owned]

def birth(pid):
    # SDK proc_bsdinfo: numeric start timeval at offset120, total136 bytes.
    library = ctypes.CDLL("/usr/lib/libproc.dylib", use_errno=True)
    library.proc_pidinfo.argtypes = [ctypes.c_int, ctypes.c_int, ctypes.c_uint64, ctypes.c_void_p, ctypes.c_int]
    library.proc_pidinfo.restype = ctypes.c_int
    buffer = ctypes.create_string_buffer(136)
    count = library.proc_pidinfo(pid, 3, 0, buffer, 136)
    if count != 136:
        if ctypes.get_errno() == errno.ESRCH or count == 0:
            return None
        raise OSError(ctypes.get_errno(), "Cannot observe owned process start identity")
    observed_pid = struct.unpack_from("=I", buffer.raw, 12)[0]
    if observed_pid != pid:
        raise ValueError("Owned process identity mismatch")
    return list(struct.unpack_from("=QQ", buffer.raw, 120))

def alive(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False

def can_signal(root_pid, root_birth, parent_pid, observed_birth):
    return root_birth is not None and parent_pid == root_pid and observed_birth == root_birth

def write_report(file, value):
    temporary = file + ".tmp"
    with open(temporary, "w") as output:
        json.dump(value, output, separators=(",", ":"))
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, file)

def main(root_pid, report_file, main_file):
    if sys.platform != "darwin" or os.getppid() != root_pid:
        raise RuntimeError("Sampler must be the owned macOS fixture's direct child")
    root_birth = birth(root_pid)
    if root_birth is None:
        raise RuntimeError("Owned fixture exited before sampler admission")
    ledger = {root_pid: root_birth, os.getpid(): birth(os.getpid())}
    report = {"rootPID": root_pid, "rootBirth": root_birth, "samplerPID": os.getpid(), "guardBytes": LIMIT, "intervalMs": 50, "sampleLimit": MAX_ROWS, "samples": [], "sampleCount": 0, "droppedSampleRows": 0, "peakOwnedRSS": 0, "ready": True, "final": False}
    write_report(report_file, report)
    guard_sent = None
    try:
        while birth(root_pid) == root_birth and os.getppid() == root_pid:
            start = time.monotonic()
            completed = subprocess.run(["/bin/ps", "-axo", "pid=,ppid=,rss="], check=True, stdout=subprocess.PIPE, text=True)
            rows = parse_rows(completed.stdout)
            owned = descendants(rows, root_pid)
            current = {row["pid"] for row in owned}
            # Previously captured children remain charged if they become orphans.
            for row in rows:
                identity = ledger.get(row["pid"])
                if row["pid"] not in current and identity is not None and birth(row["pid"]) == identity:
                    owned.append(row)
                    current.add(row["pid"])
            # The ps child itself is in this snapshot and is reaped by run().
            for row in owned:
                if row["pid"] not in ledger:
                    ledger[row["pid"]] = birth(row["pid"])
            total = sum(row["rssKiB"] * 1024 for row in owned)
            sample = {"at": time.monotonic(), "ownedRSS": total, "processes": owned}
            report["sampleCount"] += 1
            if len(report["samples"]) < MAX_ROWS:
                report["samples"].append(sample)
            else:
                report["droppedSampleRows"] += 1
            if total > report["peakOwnedRSS"]:
                report["peakOwnedRSS"] = total
                report["peakSample"] = sample
            report["ownedPIDs"] = sorted(ledger)
            if total > LIMIT and guard_sent is None:
                report["guardExceeded"] = sample
                write_report(report_file, report)
                if can_signal(root_pid, root_birth, os.getppid(), birth(root_pid)):
                    os.kill(root_pid, signal.SIGTERM)
                    guard_sent = time.monotonic()
            if guard_sent is not None and time.monotonic() - guard_sent > 1 and can_signal(root_pid, root_birth, os.getppid(), birth(root_pid)):
                os.kill(root_pid, signal.SIGKILL)
            if report["sampleCount"] % 10 == 0:
                write_report(report_file, report)
            time.sleep(max(0, .05 - (time.monotonic() - start)))
    except Exception as error:
        report["observerError"] = str(error)
        write_report(report_file, report)
        if can_signal(root_pid, root_birth, os.getppid(), birth(root_pid)):
            os.kill(root_pid, signal.SIGTERM)
    # The sampler survives fixture exit to verify GPU/compiler/utility retirement.
    try:
        with open(main_file) as source:
            main_report = json.load(source)
        for pid in main_report.get("ownedPIDs", []):
            ledger.setdefault(pid, None)
        report["mainReceipt"] = main_report
    except (FileNotFoundError, ValueError) as error:
        report["missingMainReceipt"] = True
        report["mainReceiptError"] = str(error)
    deadline = time.monotonic() + 30
    while True:
        pending = []
        replaced = []
        for pid, identity in ledger.items():
            if pid == os.getpid():
                continue
            current = birth(pid)
            if current is None:
                continue
            if identity is not None and current != identity:
                replaced.append(pid)
            elif alive(pid):
                pending.append(pid)
        if not pending or time.monotonic() >= deadline:
            break
        time.sleep(.05)
    report.update({"final": True, "ownedPIDs": sorted(ledger), "pendingPIDs": pending, "reusedPIDs": replaced, "ownedExitProof": not pending, "samplerExitRequiresExternalPIDProof": True})
    write_report(report_file, report)
    return 1 if pending or report.get("observerError") or report.get("guardExceeded") or report.get("missingMainReceipt") else 0

if __name__ == "__main__":
    sys.exit(main(int(sys.argv[1]), sys.argv[2], sys.argv[3]))
