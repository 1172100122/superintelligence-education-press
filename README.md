# SIEP · 智教版

超级智能教育出版社 / Superintelligence Education Press

这是可持续收录 HTML 教育动画的静态作品目录。首页是出版社目录；每部作品有独立地址。目前收录《差一点，还是等于？》。

## 目录结构

```text
index.html                 出版社首页与作品卡片
works/
  limits/index.html        《差一点，还是等于？》完整自包含版本
.nojekyll                  不使用 Jekyll 构建
README.md                  维护说明
```

没有框架、后端、构建步骤或外部依赖。直接打开根目录 `index.html` 即可离线浏览；首页不依赖 JavaScript、网络请求或远程字体。

## 添加下一部动画

1. 新建 `works/作品英文短名/`，放入该作品的 `index.html`；如有资源，一并放入该目录并使用相对路径。
2. 复制首页中一个完整的 `<article class="work">…</article>`，修改链接、标题、分类、简介与封面编号。
3. 给新卡片的标题、简介使用唯一 `id`，同步修改链接的 `aria-labelledby` 与 `aria-describedby`；更新目录右侧作品数量。
4. 本地打开首页，检查卡片链接、手机布局、键盘操作和动画播放。不要使用以 `/` 开头的站内路径，以兼容 GitHub 项目站点的仓库路径前缀。

## GitHub Pages

在仓库 Settings → Pages 中，将 Source 设为 **Deploy from a branch**，Branch 选择 **main**，目录选择 **/(root)**，保存。无需 GitHub Actions 配置或额外构建。

部署后首页地址：`https://1172100122.github.io/superintelligence-education-press/`

该地址仅为按仓库名称配置时的预期地址；是否已发布应以 Pages 显示的部署状态与实际访问结果为准。

## 发布前检查

- GitHub Pages 发布的内容可被公众访问；公开仓库中的源文件也公开可见。
- 只提交计划公开的作品、资源与文档。不要提交密码、API 密钥、访问令牌、`.env`、私人文件或未获授权的素材。
- 《差一点，还是等于？》内嵌了播放所需资源。浏览器通常要求首次点击播放/开始后才能启用声音；进入作品后先点击一次播放，并检查设备音量。
- 首页和作品均可直接用 `file://` 打开。若未来作品依赖网络接口或浏览器限制的能力，应在对应作品说明中单独注明。
