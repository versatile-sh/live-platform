import time, subprocess, sys
print(time.time_ns(), flush=True)
subprocess.run(sys.argv[1], shell=True)
