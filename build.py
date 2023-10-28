#! /usr/bin/env python3

import os
import stat
import shutil
import zipfile
from io import BytesIO as StringIO

PACKAGE_NAME = "quendor"
PACKAGE_DIRECTORY = PACKAGE_NAME
PYTHON_DIRECTIVE = "#!/usr/bin/env python3"

# Copy the src/quendor directory to the project directory
shutil.copytree("src/quendor", PACKAGE_DIRECTORY)

PACKED = StringIO()
PACKED_WRITER = zipfile.ZipFile(PACKED, "w", zipfile.ZIP_DEFLATED)

for dir_path, _dir_names, file_names in os.walk(PACKAGE_DIRECTORY):
    for file_name in file_names:
        file_path = os.path.join(dir_path, file_name)
        PACKED_WRITER.write(file_path)

PACKED_WRITER.writestr(
    "__main__.py",
    f"""
from {PACKAGE_NAME} import __main__
if __name__ == '__main__':
    __main__.main()
""",
)

PACKED_WRITER.close()

PYTHON_FILE = PACKAGE_DIRECTORY + ".py"

with open(PYTHON_FILE, "wb") as f:
    SHEBANG = bytes((PYTHON_DIRECTIVE + "\n").encode("ascii"))
    f.write(SHEBANG)
    f.write(PACKED.getvalue())

os.chmod(PYTHON_FILE, stat.S_IRWXU | stat.S_IRGRP | stat.S_IROTH)

# Delete the copied quendor directory
shutil.rmtree(PACKAGE_DIRECTORY)
