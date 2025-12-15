import { tool } from "@opencode-ai/plugin"
import { execSync } from "child_process"
import { writeFileSync, unlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

export default tool({
  description: "Set the opacity of the VS Code window. Use a percentage value from 0 (fully transparent) to 100 (fully opaque).",
  args: {
    percent: tool.schema
      .number()
      .min(0)
      .max(100)
      .describe("Opacity percentage (0 = fully transparent, 100 = fully opaque)"),
  },
  async execute(args) {
    const { percent } = args

    // Convert percentage to Windows opacity value (0-255)
    const opacity = Math.round((percent / 100) * 255)

    // PowerShell script to set VS Code window opacity using Windows API
    const powershellScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WindowHelper {
    [DllImport("user32.dll")]
    public static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

    [DllImport("user32.dll")]
    public static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll")]
    public static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);

    public const int GWL_EXSTYLE = -20;
    public const int WS_EX_LAYERED = 0x80000;
    public const int LWA_ALPHA = 0x2;
}
"@

$opacity = ${opacity}
$percent = ${percent}

# Get all VS Code processes
$vscodeProcesses = Get-Process -Name "Code" -ErrorAction SilentlyContinue

if ($null -eq $vscodeProcesses -or $vscodeProcesses.Count -eq 0) {
    Write-Output "Error: No VS Code window found"
    exit 1
}

$windowsSet = 0

foreach ($proc in $vscodeProcesses) {
    if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
        $hwnd = $proc.MainWindowHandle

        # Add WS_EX_LAYERED style if not already present
        $exStyle = [WindowHelper]::GetWindowLong($hwnd, [WindowHelper]::GWL_EXSTYLE)
        if (($exStyle -band [WindowHelper]::WS_EX_LAYERED) -eq 0) {
            [WindowHelper]::SetWindowLong($hwnd, [WindowHelper]::GWL_EXSTYLE, $exStyle -bor [WindowHelper]::WS_EX_LAYERED) | Out-Null
        }

        # Set the window opacity
        [WindowHelper]::SetLayeredWindowAttributes($hwnd, 0, $opacity, [WindowHelper]::LWA_ALPHA) | Out-Null
        $windowsSet++
    }
}

if ($windowsSet -gt 0) {
    Write-Output "Successfully set VS Code opacity to $percent% ($opacity/255) on $windowsSet window(s)"
} else {
    Write-Output "Error: Could not find VS Code main window handle"
    exit 1
}
`

    // Write script to temp file to avoid escaping issues
    const tempFile = join(tmpdir(), `vsopac_${Date.now()}.ps1`)

    try {
      writeFileSync(tempFile, powershellScript, "utf-8")

      const result = execSync(
        `powershell -ExecutionPolicy Bypass -File "${tempFile}"`,
        { encoding: "utf-8", timeout: 15000 }
      )

      return result.trim()
    } catch (error: any) {
      const stderr = error.stderr?.toString() || ""
      const stdout = error.stdout?.toString() || ""
      return `Error setting opacity: ${stderr || stdout || error.message || error}`
    } finally {
      try {
        unlinkSync(tempFile)
      } catch {
        // Ignore cleanup errors
      }
    }
  },
})
