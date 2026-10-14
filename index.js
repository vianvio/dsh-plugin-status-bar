/**
 * dsh-plugin-status-bar — 宿主半体
 *
 * 这个插件是纯客户端基础设施：宿主侧不做任何事（不注入提示词、不注册工具），
 * 只需要作为一个 Loader 条目存在，客户端半体（client.js）才能被发布到浏览器端。
 * 因此这里只导出稳定名字与空 apply。 */
export const name = "dsh-status-bar";
export const inject = [];

export function apply() {
  /* 无宿主侧行为：容器完全运行在客户端 */
}
