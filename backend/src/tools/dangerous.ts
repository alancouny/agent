// ============================================================
// 危险工具判定（R5）——名称/描述模式启发式。
//
// 规则（PRD Q-R5-2 已拍板"宁可多审批"）：
//   - 文件写类：write|save|create|append|delete|remove|edit|rename|move|mkdir|upload|rmdir|rm\b
//   - shell 执行类：exec|run|command|shell|terminal|bash|zsh|powershell|cmd|sh\b|spawn|execute
// 误伤接受（如 save_settings 被判定为文件写），用户级覆盖（P2）本批不做。
//
// 唯一入口：dangerous 字段只由 MCP 注册路径写入（mcp/manager.ts），
// 内置工具不打标（builtin.ts 等零改动），确保既有审批行为不变（AC-R5-4）。
// ============================================================

/** 文件写类危险工具名称模式（设计原文：宽松子串匹配，仅 rm 带词边界；rmdir 为 rm -rf 类语义显式补录）。 */
const FILE_WRITE_PATTERN = /write|save|create|append|delete|remove|edit|rename|move|mkdir|upload|rmdir|rm\b/i;

/** shell 执行类危险工具名称模式（设计原文：宽松子串匹配，仅 sh 带词边界）。 */
const SHELL_EXEC_PATTERN = /exec|run|command|shell|terminal|bash|zsh|powershell|cmd|sh\b|spawn|execute/i;

export type DangerClass = 'file_write' | 'shell_exec';

/** 按名称分类危险工具：返回 'file_write' | 'shell_exec' | null（不危险）。 */
export function classifyDanger(name: string): DangerClass | null {
  if (FILE_WRITE_PATTERN.test(name)) return 'file_write';
  if (SHELL_EXEC_PATTERN.test(name)) return 'shell_exec';
  return null;
}

/** 名称是否命中危险工具规则（文件写或 shell 执行）。 */
export function isDangerousToolName(name: string): boolean {
  return classifyDanger(name) !== null;
}

/**
 * 名称 + 描述双重判定（描述兜底：部分 MCP 工具名不含模式但描述说明其危险性）。
 * 用于 MCP 面板展示与测试；注册路径（manager.ts）按设计仅用 isDangerousToolName。
 */
export function isDangerousTool(name: string, description = ''): boolean {
  if (isDangerousToolName(name)) return true;
  if (!description) return false;
  return FILE_WRITE_PATTERN.test(description) || SHELL_EXEC_PATTERN.test(description);
}
