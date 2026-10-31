"""Validate inherited Linux flock identity and ownership before using it."""
import fcntl
import os
import stat
import sys


def verify(fd, path):
    inherited = os.fstat(fd)
    expected = os.stat(path, follow_symlinks=False)
    if (not stat.S_ISREG(inherited.st_mode) or inherited.st_uid != 0 or
            inherited.st_mode & 0o077 or
            (inherited.st_dev, inherited.st_ino) != (expected.st_dev, expected.st_ino)):
        raise ValueError('Untrusted operation lock')
    # An independent open must be blocked, proving a lock exists on this inode.
    probe = os.open(path, os.O_RDWR | os.O_NOFOLLOW)
    try:
        try:
            fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            raise ValueError('Operation lock was not acquired')
        # This succeeds only when our inherited description owns that exclusive lock.
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    finally:
        os.close(probe)


if __name__ == '__main__':
    try:
        verify(int(sys.argv[1]), sys.argv[2])
    except Exception:
        raise SystemExit('Invalid inherited operation lock') from None
