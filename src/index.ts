import { SiyuanApi as sApi } from './apis/siyuanApi';
import { MemosApi as mApi } from './apis/memosApi';
import { print, getAttrList, getSvgHtml, isObjectEmpty } from "./utils";
import { IGroupedData } from './interface';
import { sMaps } from './constant';
import { Plugin, Setting, getFrontend } from "siyuan";
import "@/index.scss";
import moment from "moment";

// 调试
const debug = false;

// 固化数据
const STORAGE_NAME = "memos-sync-config"; // 配置名称
const MEMOS_ASSETS_DIR = "assets/memos";  // 文件存储路径
const FORMAT = {  // 格式化规则
  date: 'YYYY-MM-DD',
  datetime: 'YYYY-MM-DD HH:mm:ss'
}

let onSyncEndEvent: EventListener;

export default class MemosSync extends Plugin {
  private isMobile: boolean;
  private siyuanStorage;
  private topBarElement;
  private syncing: boolean = false;
  private memosService;
  private nowNotebooks;

  /**
   * 初始化数据
   */
  async initData() {
    this.data[STORAGE_NAME] = await this.loadData(STORAGE_NAME) || {};

    let defaultConfig = {
      baseUrl: "",
      accessToken: "",
      lastSyncTime: moment().format("2000-01-01 00:00:00"),
      syncMode: "",
      notebookId: "",
      pagePath: "",
      markMode: sMaps.MARK_MAP.blockRef,
      imageLayout: sMaps.IMAGE_LAYOUT.direction,
      superLabelMode: sMaps.IS_USE.no,
      superLabelText: "",
      resourceDownloadMode: sMaps.RESOURCE_DOWNLOAD_MODE.first,
      biDirectionalLinksMode: sMaps.IS_USE.no,
      subjectPath: ""
    }

    let configData = this.data[STORAGE_NAME];
    for (let k in defaultConfig) {
      if (configData[k] === undefined || configData[k] === "undefined") {
        configData[k] = defaultConfig[k];
      }
    }

    this.memosService = new mApi(configData.baseUrl, configData.accessToken);
  }

  /**
   * 检查必填项
   * @returns
   */
  async checkRequired() {
    let configData = this.data[STORAGE_NAME];

    // TODO 必填项补充
    let requiredList = [
      configData.baseUrl, // 基础路径
      configData.accessToken, // 授权码
      configData.lastSyncTime,  // 上次同步时间
      configData.syncMode,  // 同步模式
      configData.notebookId,  // 笔记本
      configData.markMode,  // 引用处理模式
      configData.biDirectionalLinksMode, // 是否识别双向链接
      configData.imageLayout, // 图片布局
      configData.superLabelMode,  // 是否收束标签
      configData.resourceDownloadMode  // 资源下载模式
    ]

    for (let required of requiredList) {
      if (!required) {
        await sApi.pushErrMsg("请检查设置必填项是否全部配置！");
        return false;
      }
    }

    // 同步至单份文档时，需校验文档路径是否填写
    if (configData.syncMode === sMaps.SYNC_MAP.simple){
      if (!configData.pagePath){
        await sApi.pushErrMsg("请确认必填项是否全部配置！")
        return;
      }
    }

    // 收束标签时，需校验标签名称是否填写
    if (configData.superLabelMode === sMaps.IS_USE.yes) {
      if (!configData.superLabelText) {
        await sApi.pushErrMsg("请确认必填项是否全部配置！")
        return false;
      }
    }

    // 识别双向链接时，需校验主题路径是否填写
    if (configData.biDirectionalLinksMode === sMaps.IS_USE.yes){
      if (!configData.subjectPath){
        await sApi.pushErrMsg("请确认必填项是否全部配置！")
        return false;
      }
    }

    return true;
  }

  /**
   * 校验 Access Token
   * @param baseUrl - 基础路径
   * @param accessToken - 授权码
   * @param isShow - 是否显示验证成功的消息，默认为 false
   * @returns 
   */
  async checkAccessToken(baseUrl = "", accessToken = "", isShow = false) {
    let configData = this.data[STORAGE_NAME];

    baseUrl = (baseUrl === "") ? configData.baseUrl : baseUrl;
    accessToken = (accessToken === "") ? configData.accessToken : accessToken;

    if (!baseUrl || !accessToken) {
      await sApi.pushErrMsg("未配置服务器路径或授权码！")
      return false;
    }
    try {
      let service = new mApi(baseUrl, accessToken);

      // 检查服务器是否正常运行
      let pingResponse = await service.pingMemos();

      if (!pingResponse.ok) {
        throw new Error(`HTTP error! status: ${pingResponse.status}`);
      }

      let servicePing = { success: await pingResponse.json() };

      if (!servicePing) {
        await sApi.pushErrMsg("Memos 连接失败，请检查服务器是否运行正常！");
        return false;
      }

      // 校验 Access Token
      let response = await service.getUserMe();

      if (!response.ok) {
        if (response.status == 401) {
          await sApi.pushErrMsg("Access Token 验证失败！");
          return false;
        }
        throw new Error(`HTTP error! status: ${pingResponse.status}`);
      }

      if (isShow) {
        await sApi.pushMsg("Access Token 验证通过");
      }
      return true;
    } catch (error) {
      await sApi.pushErrMsg(`plugin-memos-sync: ${error}`);
      throw new Error(`${error}`);
    }
  }

  /**
   * 同步前检查
   * @returns {boolean}
   */
  async checkBeforeSync() {
    let requiredIsOk = await this.checkRequired();
    let tokenIsOk = await this.checkAccessToken();
    return (requiredIsOk && tokenIsOk) ? true : false;
  }

  /**
   * 检查是否有数据要更新，有则改变图标
   */
  async checkNew() {
    let isReady = await this.checkBeforeSync();
    let memos = await this.getLatestMemos();
    if (isReady && memos.addList.length > 0) {
      this.topBarElement.innerHTML = getSvgHtml("new", this.isMobile);
    }
  }

  /**
   * 处理监听同步事件
   * @param detail 
   */
  async eventBusHandler(detail) {
    await this.checkNew(); // 检查 Memos 是否有新数据
  }

  /**
   * 获取最新记录，以上次同步时间为起点
   * @returns
   */
  async getLatestMemos() {
    // 读取配置
    let configData = this.data[STORAGE_NAME];

    // 获取上次同步时间
    let lastSyncTime = configData.lastSyncTime;
    const today = new Date();
    let latest_updated = moment(lastSyncTime, FORMAT.datetime, true).isValid()
      ? moment(lastSyncTime, FORMAT.datetime).toDate()
      : moment(today, FORMAT.datetime).toDate()

    // 获取上次同步时间戳
    let latest_updated_at_timestamp = moment(latest_updated).unix();

    // 返回的数据结构
    let result = {
      addList: [],
      deleteList: []
    };

    // 限制获取条数
    const LIMIT = 200;
    // 偏移
    let offset = 0;

    while (true) {
      try {
        let param = {
          limit: `${LIMIT}`,
          offset: `${offset}`,
          rowStatus: 'NORMAL'
        }

        let response = await this.memosService.getMemos(param);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const records = await response.json();

        if (records.length == 0) {
          break;
        }

        let noMore = records.length < LIMIT;

        // 需要添加的记录
        let addList = records.filter(item => item.displayTs > latest_updated_at_timestamp);
        let deleteList = records.filter(item => {
          // 获取每个字典的创建时间和更新时间
          let createdTime = item.createdTs;
          let updatedTime = item.updatedTs;

          // 筛选条件：创建时间小于目标时间，且更新时间大于目标时间
          return createdTime < latest_updated_at_timestamp && updatedTime > latest_updated_at_timestamp;
        });

        result.addList = result.addList.concat(addList);
        result.deleteList = result.deleteList.concat(deleteList);

        if (noMore) { // 没有更多了
          break;
        } else {
          offset += LIMIT;
        }
      } catch (error) {
        await sApi.pushErrMsg(`plugin-memos-sync: ${error}`);
        throw new Error(error);
      }
    }
    return result;
  }

  /**
   * 开始同步
   */
  async runSync() {
    // 防止快速点击、或手动和自动运行冲突。
    if (this.syncing == true) {
      await sApi.pushMsg("同步中，请稍候...");
      return;
    }

    // 运行前检查
    if (!(await this.checkBeforeSync())) {
      return;
    }

    // 图标修改
    let runBeforeSvg = this.topBarElement.innerHTML;  // 缓存
    this.syncing = true;  // 同步标志

    try {
      this.topBarElement.innerHTML = getSvgHtml("refresh", this.isMobile);  // 刷新图标

      await this.initData();  // 初始化数据
      let configData = this.data[STORAGE_NAME]; // 读取配置
      let syncMode = configData.syncMode; // 同步保存方案

      // 检查是否有新数据
      let memos = await this.getLatestMemos();

      if (memos.addList.length == 0) {
        await sApi.pushMsg("暂无新数据！");
        this.syncing = false;
        this.topBarElement.innerHTML = getSvgHtml("memos", this.isMobile);
        return;
      } else {
        await sApi.pushMsg("同步中，请稍候...");
      }

      // 保存
      let result = await this.saveToSiyuan(memos, syncMode);
      if (!result) {
        await sApi.pushErrMsg("同步失败！");
        this.topBarElement.innerHTML = runBeforeSvg; // 报错图标就恢复成之前的状态
        this.syncing = false;
        return;
      }

      // 记录同步时间,间隔1秒
      await setTimeout(async () => {
        let nowTimeText = moment().format(FORMAT.datetime);
        this.data[STORAGE_NAME]["lastSyncTime"] = nowTimeText;
        await this.saveData(STORAGE_NAME, this.data[STORAGE_NAME]);
      }, 1000)

      // 同步完成
      this.topBarElement.innerHTML = getSvgHtml("memos", this.isMobile);
      await sApi.pushMsg("同步完成！")
    } catch (error) {
      await sApi.pushErrMsg("同步失败！");
      this.topBarElement.innerHTML = runBeforeSvg; // 报错图标就恢复成之前的状态
      await sApi.pushErrMsg(`plugin-memos-sync: ${error}`);
      throw new Error(error);
    } finally {
      this.syncing = false;
    }
  }

  /**
   * 保存到思源
   * @param memos - 需要处理的记录列表
   * @param syncMode - 同步模式
   * @returns 
   */
  async saveToSiyuan(memos, syncMode) {
    let addList = memos.addList;
    let deleteList = memos.deleteList;

    // 数据转换
    let { memoObjList, resouceList, relationList } = await this.batchHandleMemos(addList);

    // 下载图片
    let isDownloaded = await this.resourceDownload(resouceList);

    // 数据写入
    if (isDownloaded) {
      if (syncMode === sMaps.SYNC_MAP.block) {
        // print("写入块...");
        await this.putBlock(memoObjList, relationList, deleteList);
      } else if (syncMode === sMaps.SYNC_MAP.page) {
        await this.putPage(memoObjList, relationList);
      } else if (syncMode === sMaps.SYNC_MAP.simple) {
        await this.putSimplePage(memoObjList, relationList, deleteList);
      } else {
        return false;
      }
      return true;
    }
  }

  // 数据处理

  /**
   * 批量处理记录
   * @param memos - 记录列表
   * @returns 
   */
  async batchHandleMemos(memos) {
    let memoObjList = [];
    let resouceList = [];
    let relationList = [];

    for (let memo of memos){
      let memoObj = await this.handelMemo(memo);
      memoObjList.push(memoObj);
      resouceList = resouceList.concat(memoObj.resourceList);
      relationList = relationList.concat(memoObj.relationList);
    }

    const relations = Array.from(
      new Map(relationList.map((relation) => [relation.memoId, relation])).values()
    );

    return {
      memoObjList: memoObjList,
      resouceList: resouceList,
      relationList: relations
    }
  }

  /**
   * 解析记录
   * @param memo - 记录
   */
  async handelMemo(memo) {
    // 获取数据
    let memoId = memo.id;
    let contentText = memo.content;
    let resourceList = memo.resourceList;
    let relationList = memo.relationList;
    let dispalyDate = moment.unix(memo.displayTs).format(FORMAT.datetime);

    // 文档标题
    let title = `${dispalyDate}・#${memoId}`;

    // 资源处理
    let resourceMaps = this.batchHandelResource(resourceList);
    let resourceLinks = resourceMaps.resourceLinks;
    let imageLinks = resourceMaps.imageLinks;
    let resources = resourceMaps.resources;

    // 标签处理
    contentText = await this.handleContent(contentText);

    // 文本合并
    let content = `${contentText}\n${resourceLinks}`;

    return {
      memoId: memoId, // Memos Id
      title: title, // 标题
      content: content, // 内容
      resourceList: resourceList, // 资源列表
      relationList: relationList, // 关系列表
      contentText: contentText, // 不包含资源的纯文本
      contentLink: resourceLinks, // 仅包含资源的文本
      imageLinks: imageLinks, // 仅包含图片的文本
      resources: resources, // 不包含图片的资源列表
      dispalyDate: dispalyDate,  // 显示日期
      displayts: memo.displayTs // 显示时间戳
    };
  }

  /**
   * 批量解析资源
   * @param resourceList - 资源列表
   * @returns
   */
  batchHandelResource(resourceList) {
    let resourceLinks = ""; // 所有资源链接
    let imageLinks = "";  // 图片链接
    let resources = [];  // 存放所有非图片的资源

    let configData = this.data[STORAGE_NAME];
    let imageLayout = configData.imageLayout;

    resourceList.forEach(resource => {
      // 解析资源，获取资源数据
      let resourceMap = this.handleResource(resource);
      let mdLink = resourceMap.mdLink;
      let resourceTypeText = resourceMap.resourceTypeText;
      if (mdLink) {
        // 针对保存到块的处理
        if (resourceTypeText == "image") {
          imageLinks += `${mdLink}`;
          if (imageLayout === sMaps.IMAGE_LAYOUT.direction && (resource !== resourceList[resourceList.length - 1])) {
            imageLinks += "\n";
          }
        } else {
          resources.push(mdLink);
        }

        // 针对保存到文档的处理
        resourceLinks += `${mdLink}`;
        if (resource !== resourceList[resourceList.length - 1]) {
          resourceLinks += "\n";
        }
      }
    })
    return {
      resourceLinks: resourceLinks,
      imageLinks: imageLinks,
      resources: resources
    };
  }

  /**
   * 解析资源
   * @param resource - 资源
   * @returns 
   */
  handleResource(resource) {
    // 获取数据
    let resourceType = resource.type;
    let resourceTypeText = resourceType.split('/')[0]; // 资源类型
    let resourceFilename = resource.filename; // 资源文件名称
    let resourceName = resource.name; // 资源名称
    let resourceId = resource.id; // 资源ID

    // 变量定义
    let link: string;
    let downloadLink: string;

    // 判断是否是外部链接
    if (resource.externalLink === "") {
      // 获取文件后缀名
      let splitList = resourceFilename.split('.');
      let end = splitList[splitList.length - 1];

      // 生成新的文件名称
      let name = `${resource.createdTs}.${end}`;

      // 生成文件链接
      link = `${MEMOS_ASSETS_DIR}/${resource.id}_${name}`;

      // 更新下载链接
      downloadLink = link;
    } else {
      link = resource.externalLink;
      downloadLink = "";
    }

    // 生成符合MD格式的文本
    let mdLink = (resourceTypeText == 'image') ? `![${resourceFilename}](${link})` : `[${resourceFilename}](${link})`;
    // print('mdLink', mdLink);

    return {
      mdLink: mdLink,
      downloadLink: downloadLink,
      resourceId: resourceId,
      resourceTypeText: resourceTypeText,
      resourceName: resourceName
    };
  }

  /**
   * 处理内容
   * @param content - 内容
   * @returns 处理后的内容
   */
  async handleContent(content){
    let configData = this.data[STORAGE_NAME]; // 读取配置
    let biDirectionalLinksMode = configData.biDirectionalLinksMode; // 双链标识

    if (biDirectionalLinksMode === sMaps.IS_USE.yes){
      if (debug){
        print("正在处理双向链接...");
      }
      content = await this.handleDirectionalLinks(content);
      if (debug){
        print("双向链接处理完成！");
      }
    }

    if (debug){
      print("正在处理标签...");
    }
    content = await this.handleTag(content);
    if (debug){
      print("标签处理完成！");
    }
    return content;
  }

  /**
   * 处理双链标识
   * @param content - 内容
   * @returns - 处理后的内容
   */
  async handleDirectionalLinks(content){
    const regex = /(?<=\(\().*?(?=\)\))/g;  // 仅匹配文档名称
    if (regex.test(content)){
      let matchList = content.match(regex);
      if (debug){
        print("双向链接正则匹配结果", matchList);
      }
      for (let documentName of matchList) {
        let documentId = await this.getDocumentIdByName(documentName);
        if (debug){
          print("当前使用的文档ID", documentId);
        }
        content = content.replace(regex, (match) => `${documentId} "${match}"`)
        if (debug){
          print("替换后的内容", content);
        }
      }
    }
    return content;
  }

  /**
   * 标签处理
   * @param content 正文
   * @param tags 
   * @returns 
   */
  handleTag(content) {
    const regex = /(?<=#).*?(?=\s|#|$)/g;  // 标签匹配规则

    let configData = this.data[STORAGE_NAME]; // 读取配置
    let labelName = configData.superLabelText;
    let result;

    if (configData.superLabelMode === sMaps.IS_USE.yes) {
      result = content.replace(regex, (match) => `${labelName}/${match}# `);
    } else {
      result = content.replace(regex, (match) => `${match}# `);
    }
    return result;
  }

  // 数据保存

  /**
   * 下载资源到本地
   * @param resourceList - 资源列表
   * @returns 
   */
  async resourceDownload(resourceList) {
    let configData = this.data[STORAGE_NAME]; // 读取配置
    let resourceDownloadMode = configData.resourceDownloadMode;

    // 处理图片逻辑
    try {
      for (let resource of resourceList) {
        // 解析资源
        let res = this.handleResource(resource);

        // 如果 downloadLink 为空，则跳过当前循环
        if (res.downloadLink === "") {
          continue;
        }

        // 生成保存路径
        let savePath = `data/${res.downloadLink}`;

        // 获取资源文件
        let response;
        if (resourceDownloadMode === sMaps.RESOURCE_DOWNLOAD_MODE.first) {
          let resourceId = res.resourceId;
          response = await this.memosService.downloadResourceById(resourceId);
        } else if (resourceDownloadMode === sMaps.RESOURCE_DOWNLOAD_MODE.second) {
          let resourceName = res.resourceName;
          response = await this.memosService.downloadResourceByName(resourceName);
        } else {
          return;
        }

        let fileBlob = await response.blob();

        // 下载文件到思源
        await sApi.putFile(savePath, fileBlob);
      }
    } catch (error) {
      await sApi.pushErrMsg(`plugin-memos-sync: ${error}`);
      throw new Error(error);
    }
    return true;
  }

  /**
   * 以块的形式写入思源
   * @param memoObjList 
   * @param relationList 
   * @param deleteList 
   */
  async putBlock(memoObjList, relationList, deleteList) {
    let configData = this.data[STORAGE_NAME];
    let notebookId = configData.notebookId; // 笔记本ID

    if (!this.isExistNotebook(notebookId)) {
      await sApi.pushErrMsg("你选择笔记本当前不存在！");
      return;
    }

    // 删除旧块
    let delIdList = await this.getDelBlockIdList(deleteList);
    if (delIdList.length > 0) {
      await this.batchDeleteBlock(delIdList);
    }

    // 获取新的表
    let blockIdMaps = await this.getBlockIdMaps();

    // 按日期分组数据
    let groupedData: IGroupedData = await this.groupListByDate(memoObjList, 'dispalyDate');

    // 分批写入
    for (const [dispalyDate, memoObjs] of Object.entries(groupedData)) {
      // 获取文档ID
      let pageId = await this.searchDailyNote(notebookId, dispalyDate);
      memoObjs.sort((a, b) => +a.displayts - +b.displayts);
      let blockIdMap = await this.batchHandleContentBlock(pageId, memoObjs);
      Object.assign(blockIdMaps, blockIdMap);
    }

    // 引用关联
    await this.relationBlock(relationList, blockIdMaps);

    // 设置块属性
    await this.batchSetBlockAttr(blockIdMaps);
  }

  /**
   * 以页面的形式写入思源
   * @param memoObjList 
   * @param relationList 
   * @returns 
   */
  async putPage(memoObjList, relationList) {
    let configData = this.data[STORAGE_NAME];
    let notebookId = configData.notebookId;
    let pagePath = configData.pagePath;
    let blockIdMaps = {};

    // 判断笔记本是否存在
    if (!this.isExistNotebook(notebookId)) {
      await sApi.pushErrMsg("你选择的笔记本当前不存在！");
    }

    // 排序
    memoObjList.sort((a, b) => +a.displayts - +b.displayts);

    // 保存为页面
    for (let memoObj of memoObjList) {
      let memoId = memoObj.memoId;
      let title = memoObj.title;
      let path = `${pagePath}/${title}`
      let md = (memoObj.contentText) ? memoObj.contentText : "";
      let response = await sApi.createDocWithMd(notebookId, path, md);

      if (!sApi.isOK(response)) {
        continue;
      }

      let blockId = response.data;

      // 图片
      let imageLinks = memoObj.imageLinks;
      if (imageLinks) {
        await sApi.appendBlock(blockId, imageLinks);
      }
      // 其它资源
      let resources = memoObj.resources;
      if (resources.length > 0) {
        for (let r of resources) {
          await sApi.appendBlock(blockId, r);
        }
      }

      blockIdMaps[memoId] = blockId;
    }

    // 引用关联
    await this.relationBlock(relationList, blockIdMaps);
  }

  /**
   * 保存至单份文档
   * @param memoObjList 
   * @param relationList 
   * @param deleteList 
   * @returns 
   */
  async putSimplePage(memoObjList, relationList, deleteList) {
    let configData = this.data[STORAGE_NAME];
    let notebookId = configData.notebookId; // 笔记本ID
    let pagePath = configData.pagePath; // 文档路径

    if (!this.isExistNotebook(notebookId)) {
      await sApi.pushErrMsg("你选择笔记本当前不存在！");
      return;
    }

    // 删除旧块
    let delIdList = await this.getDelBlockIdList(deleteList);
    if (delIdList.length > 0) {
      await this.batchDeleteBlock(delIdList);
    }

    // 获取页面ID
    let pageId = await this.getIdByPath(notebookId, pagePath);

    // 获取新的表
    let blockIdMaps = await this.getBlockIdMaps();

    // 排序
    let ascMemoObjList = memoObjList.sort((a, b) => +a.displayts - +b.displayts);

    // 批量写入
    let blockIdMap = await this.batchSaveToSimplePage(pageId, ascMemoObjList);
    Object.assign(blockIdMaps, blockIdMap);

    // 引用关联
    await this.relationBlock(relationList, blockIdMaps);

    // 设置块属性
    await this.batchSetBlockAttr(blockIdMaps);
  }

  // 数据保存相关工具方法

  /**
   * 批量将记录添加到块中
   * @param pageId - 文档ID
   * @param memoObjList - 需要添加的记录列表
   * @returns 
   */
  async batchHandleContentBlock(pageId, memoObjList) {
    let blockIdMap = {};

    for (let memoObj of memoObjList) {
      let memoId = memoObj.memoId;
      let response = await this.handleContentBlock(pageId, memoObj);

      if (!response) {
        continue;
      }

      let blockId = await this.getResponseBlockId(response);
      blockIdMap[memoId] = blockId;
    }
    return blockIdMap;
  }

  /**
   * 将记录添加到块中
   * @param pageId - 文档ID
   * @param memoObj - 需要添加的记录
   * @returns 
   */
  async handleContentBlock(pageId, memoObj) {
    let title = memoObj.title;

    // 标题写入
    let contentTitle = `* ${title}`;
    // let response = await sApi.appendBlock(pageId, contentTitle);
    let response = await sApi.insertBlock(contentTitle, {"parentID": pageId})
    if (!sApi.isOK(response)) {
      return;
    }

    let bid = await this.getResponseBlockId(response);
    let childResponse = await sApi.getChildBlocks(bid);

    if (!sApi.isOK(childResponse)) {
      return;
    }

    // 内容写入
    let childId = childResponse.data[0].id;

    // 文本
    let contentText = memoObj.contentText;
    if (contentText) {
      await sApi.appendBlock(childId, contentText);
    }

    // 图片
    let imageLinks = memoObj.imageLinks;
    if (imageLinks) {
      await sApi.appendBlock(childId, imageLinks);
    }

    // 其它资源
    let resources = memoObj.resources;
    if (resources.length > 0) {
      for (let r of resources) {
        await sApi.appendBlock(childId, r);
      }
    }

    return response;
  }

  /**
   * 批量处理数据，保存至单份文档
   * @param pageId - 页面ID
   * @param memoObjList - 记录
   * @returns 
   */
  async batchSaveToSimplePage(pageId, memoObjList) {
    let blockIdMap = {};

    // 获取页面最上级的块ID
    let response = await sApi.getChildBlocks(pageId);
    if (!sApi.isOK(response)) {
      return;
    }

    let blockIdList = response.data;
    let parentID;

    // 如果没有，先将第一条记录写入，获取到对应的块ID
    if (blockIdList.length > 0) {
      parentID = blockIdList[0].id;
    }else{
      return;
    }

    if (debug){
      print("parentID", parentID);
    }

    // 循环，将上一次插入的块ID，作为传参
    for (let memoObj of memoObjList) {
      let response = await this.saveToSimplePage(parentID, memoObj);
      if (!response) {
        continue;
      }

      let memoId = memoObj.memoId;
      let blockId = await this.getResponseBlockId(response);
      parentID = blockId;
      blockIdMap[memoId] = blockId;
    }
    return blockIdMap;
  }

  /**
   * 将一条记录保存至单份文档
   * @param targetID - 用于定位的块ID
   * @param memoObj - 记录
   * @returns 
   */
  async saveToSimplePage(targetID, memoObj) {
    // 标题写入
    let title = memoObj.title;
    let contentTitle = `* ${title}`;

    let response = await sApi.insertBlock(contentTitle, {"nextID": targetID});
    if (!sApi.isOK(response)) {
      return;
    }

    if (debug){
      print("response", response);
    }

    let bid = await this.getResponseBlockId(response);

    let childResponse = await sApi.getChildBlocks(bid);
    if (!sApi.isOK(childResponse)) {
      return;
    }

    // 内容写入
    let childId = childResponse.data[0].id;

    // 文本
    let contentText = memoObj.contentText;
    if (contentText) {
      await sApi.appendBlock(childId, contentText);
    }

    // 图片
    let imageLinks = memoObj.imageLinks;
    if (imageLinks) {
      await sApi.appendBlock(childId, imageLinks);
    }

    // 其它资源
    let resources = memoObj.resources;
    if (resources.length > 0) {
      for (let r of resources) {
        await sApi.appendBlock(childId, r);
      }
    }

    return response;
  }

  /**
   * 引用处理
   * @param relationList 
   * @param blockIdMaps 
   */
  async relationBlock(relationList, blockIdMaps) {
    let configData = this.data[STORAGE_NAME];
    let markMode = configData.markMode;
    let content = "";
    let error_blockIdList = []
    let syncMode = configData.syncMode;

    for (let relation of relationList) {
      let memoId = relation.memoId;
      let relatedMemoId = relation.relatedMemoId;
      let blockId = blockIdMaps[memoId];
      let relatedBlockId = blockIdMaps[relatedMemoId];

      let rMap = {
        relation: relation,
        memoId: memoId,
        relatedMemoId: relatedMemoId,
        blockId: blockId,
        relatedBlockId: relatedBlockId
      }

      if (!blockId) {
        error_blockIdList.push(rMap);
        continue;
      }

      let useId = blockId;

      if (syncMode === sMaps.SYNC_MAP.block) {
        let response = await sApi.getChildBlocks(blockId);

        if (!sApi.isOK(response)) {
          continue;
        }
        let childId = response.data[0].id;
        useId = childId;
      }

      if (markMode === sMaps.MARK_MAP.blockEmbed) {
        content = `{{select * from blocks where id="${relatedBlockId}"}}`;
      } else if (markMode === sMaps.MARK_MAP.blockRef) {
        content = `((${relatedBlockId} "@${relatedMemoId}"))`;
      } else {
        return;
      }

      await sApi.appendBlock(useId, content);
    }
    return error_blockIdList;
  }

  /**
   * 批量设置块属性
   * @param blockIdMaps 
   */
  async batchSetBlockAttr(blockIdMaps: IBlockIdMaps | {}) {
    if (isObjectEmpty(blockIdMaps)) {
      return;
    }

    for (const [memoId, blockId] of Object.entries(blockIdMaps)) {
      let attrs = {
        "custom-memo-id": `${memoId}`
      }

      await sApi.setBlockAttrs(blockId, attrs);
    }
  }

  // 工具方法

  /**
   * 获取笔记本列表封装成映射
   * @returns 
   */
  async getNotebooks() {
    let response = await sApi.lsNotebooks();

    if (!sApi.isOK(response)) {
      await sApi.pushErrMsg("获取笔记本列表失败");
      return;
    }

    let result = [];
    let notebooks = response.data.notebooks;

    for (let notebook of notebooks) {
      result.push({
        value: notebook['id'],
        text: notebook['name']
      });
    }
    return result;
  }

  /**
   * 判断某个笔记本是否存在
   * @param notebookId - 笔记本ID
   * @returns 
   */
  async isExistNotebook(notebookId) {
    let notebookMaps = await this.getNotebooks();
    return (notebookId in notebookMaps);
  }

  /**
   * 获得可读路径
   * @param notebookId 笔记本ID
   * @param date 日期
   * @returns 文档路径 null or string
   */
  async getPastDNHPath(notebookId: string, date: string): Promise<string> {
    let notebookConfResponse = await sApi.getNotebookConf(notebookId);

    if (!sApi.isOK(notebookConfResponse)) {
      await sApi.pushErrMsg("找不到该笔记本！");
      return;
    }

    let dailyNoteSavePath = notebookConfResponse.data.conf.dailyNoteSavePath;

    let dateStr = moment(date).format(FORMAT.date);
    let sprig = `toDate "2006-01-02" "${dateStr}"`;

    dailyNoteSavePath = dailyNoteSavePath.replaceAll(/now/g, sprig);

    let response = await sApi.renderSprig(dailyNoteSavePath);

    if (!sApi.isOK(response)) {
      await sApi.pushErrMsg("模板解析失败！");
      return;
    }

    let hpath = response.data;
    return hpath;
  }

  /**
   * 根据路径获取文档ID
   * @param notebookId 笔记本ID
   * @param path 文档路径
   * @returns 文档ID
   */
  async getIdByPath(notebookId: string, path: string): Promise<string> {
    let pageId = "";  // 文档ID

    let response = await sApi.getIDsByHPath(notebookId, path);
    if (!sApi.isOK(response)) {
      return;
    }

    let IDs = response.data;

    if (IDs === null || IDs.length === 0) {
      let response = await sApi.createDocWithMd(notebookId, path, "");
      if (!sApi.isOK(response)) {
        return;
      }
      pageId = response.data;
    } else {
      pageId = IDs[0];
    }
    return pageId;
  }

  /**
   * 根据日期查询是否存在该日的Daily Note，若存在，返回文档ID，若不存在，自动创建并返回文档ID
   * @param notebookId 笔记本ID
   * @param date 日期
   * @returns 文档ID null or string
   */
  async searchDailyNote(notebookId: string, date: string): Promise<string> {
    // 获取可读路径
    let hpath = await this.getPastDNHPath(notebookId, date);
    if (!hpath) {
      return;
    }

    return await this.getIdByPath(notebookId, hpath);
  }

  /**
   * 根据 memosId 批量获取对应的 blockId
   * @param memosIdList - 记录id列表
   * @returns 
   */
  async batchGetAttrByMemosId(memosIdList) {
    let result = [];
    for (let memosId of memosIdList) {
      let attrList = await this.getAttrByMemosId(memosId);
      result = result.concat(attrList);
    }
    return result;
  }

  /**
   * 获取需要删除的块ID
   * @param deleteList - 需要删除的记录列表
   * @returns 
   */
  async getDelBlockIdList(deleteList) {
    let delMemosIdList = await getAttrList(deleteList, 'id'); // 提取需要删除的 memosId
    let delBlockList = await this.batchGetAttrByMemosId(delMemosIdList); // 通过 memosId 批量获取需要被删除的块
    let delBlockIdList = [];
    if (delBlockList.length !== 0) {
      delBlockIdList = await getAttrList(delBlockList, 'block_id'); // 提取需要删除 blockId
    }
    return delBlockIdList;
  }

  /**
   * 批量删除块
   * @param idList - 需要删除的块ID列表
   * @returns 
   */
  async batchDeleteBlock(idList) {
    let delErrorList = [];
    for (let id of idList) {
      let response = await sApi.deleteBlock(id);
      if (!sApi.isOK(response)) {
        delErrorList.push(id);
        break;
      }
      if (response.code == -1) {
        delErrorList.push(id);
        continue;
      }
    }
    return delErrorList;
  }

  /**
   * 获取当前的memos-block映射表
   * @returns 
   */
  async getBlockIdMaps() {
    let result = {};
    let attrs = await this.getAttrAllMemos();
    for (let attr of attrs) {
      let memosId = attr.value;
      let blockId = attr.block_id;
      result[memosId] = blockId;
    }
    return result;
  }

  /**
   * 将列表根据日期分组，以日期作为KEY
   * @param dataList 需要分组的列表
   * @param key 
   * @returns null or maps
   */
  async groupListByDate(dataList, key: string, isTimestamp = false) {
    if (dataList.length === 0 || !(key in dataList[0])) {
      throw new Error(`${key} 不存在！`);
    }

    const groupedData = dataList.reduce((result, item) => {
      // 将时间戳转换为日期字符串，作为分组的 key
      const dateKey = (isTimestamp) ? moment.unix(item[key]).format(FORMAT.date) : moment(item[key]).format(FORMAT.date);

      // 如果 result 中已有该日期的组，直接添加到该组，否则创建新组
      if (result[dateKey]) {
        result[dateKey].push(item);
      } else {
        result[dateKey] = [item];
      }
      return result;
    }, {});

    return groupedData;
  }

  /**
   * 从响应信息中提取块id
   * @param response - 响应信息
   * @returns {string}
   */
  async getResponseBlockId(response) {
    let reponseData = response.data;
    let doOperations = reponseData[0].doOperations;
    let blockId = doOperations[0].id;
    return blockId;
  }

  /**
   * 获取所有包含custom-memo-id数据
   * @returns 
   */
  async getAttrAllMemos() {
    let sql = `SELECT * FROM attributes WHERE name='custom-memo-id';`
    let response = await sApi.querySql(sql);
    return response.data;
  }

  /**
   * 根据memosId查询对应的块
   * @param memosId 
   * @returns 
   */
  async getAttrByMemosId(memosId) {
    let sql = `SELECT * FROM attributes WHERE name='custom-memo-id' AND value='${memosId}';`
    let response = await sApi.querySql(sql);
    return response.data;
  }

  /**
   * 根据块id查询块
   * @param blockId 
   * @returns 
   */
  async getBlockContentById(blockId) {
    let sql = `SELECT * FROM blocks WHERE id="${blockId}";`
    let response = await sApi.querySql(sql);
    return response.data;
  }

  /**
   * 根据文档块名称获取文档块ID，若不存在则自动新建
   * @param documentName - 文档块名称
   * @returns 文档块ID
   */
  async getDocumentIdByName(documentName){
    let configData = this.data[STORAGE_NAME]; // 读取配置
    let notebookId = configData.notebookId;
    let subjectPath = configData.subjectPath;
    let documentBlockId;

    let documentBlockList = await this.getBlockByDocumentName(documentName);
    if (debug){
      print("文档块查询结果", documentBlockList);
    }
    if (documentBlockList !== null && documentBlockList.length > 0){
      documentBlockId = documentBlockList[0].id;
    }else{
      let path = `${subjectPath}/${documentName}`;
      documentBlockId = await this.getIdByPath(notebookId, path);  
    }
    return documentBlockId
  }

  /**
   * 根据文档名称查询文档块
   * @param name - 名称
   */
  async getBlockByDocumentName(name){
    let sql = `SELECT * FROM blocks WHERE content=${name} && type='d';`
    let response = await sApi.querySql(sql);
    return response.data;
  }

  // 官方方法

  async onload() {
    // 获取本地配置
    let conResponse = await sApi.getLocalStorage();
    this.siyuanStorage = conResponse["data"];

    // 初始化配置
    await this.initData();

    const frontEnd = getFrontend();
    this.isMobile = frontEnd === "mobile" || frontEnd === "browser-mobile";

    onSyncEndEvent = this.eventBusHandler.bind(this);
    this.eventBus.on("sync-end", onSyncEndEvent);

    //顶栏图标
    let icon = getSvgHtml('memos', this.isMobile);
    this.topBarElement = this.addTopBar({
      icon: icon,
      title: "Memos同步",
      position: "right",
      callback: await this.runSync.bind(this)
    });

    let checkButtonElement = document.createElement("button"); // 校验按钮
    let baseUrlElement = document.createElement("input"); // 基础路径
    let accessTokenElement = document.createElement("input"); // 授权码
    let lastSyncTimeElement = document.createElement('input');  // 上次同步时间
    let syncModeElement;  //同步保存方案
    let notebookIdElement;  // 选择笔记本
    let pagePathElement = document.createElement('input');  // 文档路径
    let markModeElement;  // 引用处理方案
    let biDirectionalLinksModeElement;  // 双向链接符号标识
    let subjectPathElement = document.createElement('input');  // 用于主题的保存路径
    let imageLayoutElement; // 图片布局
    let superLabelModeElement; // 标签模式
    let superLabelTextElement = document.createElement('input'); // 上级标签文本
    let resourceDownloadModeElement; // 资源下载模式

    this.setting = new Setting({
      // 配置窗口大小
      width: '800px',
      height: '670px',

      confirmCallback: async () => {
        // 必填项校验
        let requiredList = [
          baseUrlElement.value, // 基础路径
          accessTokenElement.value, // 授权码
          lastSyncTimeElement.value,  // 上次同步时间
          syncModeElement.value,  // 同步模式
          notebookIdElement.value,  // 笔记本
          markModeElement.value,  // 引用处理模式
          biDirectionalLinksModeElement.value, // 是否识别双向链接
          imageLayoutElement.value, // 图片布局
          superLabelModeElement.value,  // 是否收束标签
          resourceDownloadModeElement.value  // 资源下载模式
        ]

        for (let required of requiredList) {
          if (!required) {
            await sApi.pushErrMsg("请确认必填项是否全部配置！")
            return;
          }
        }

        // 同步至单份文档时，需校验文档路径是否填写
        if (syncModeElement.value === sMaps.SYNC_MAP.simple){
          if (!pagePathElement.value){
            await sApi.pushErrMsg("请确认必填项是否全部配置！")
            return;
          }
        }


        // 收束标签时，需校验标签名称是否填写
        if (superLabelModeElement.value === sMaps.IS_USE.yes) {
          if (!superLabelTextElement.value) {
            await sApi.pushErrMsg("请确认必填项是否全部配置！")
            return;
          }
        }

        // 识别双向链接时，需校验主题路径是否填写
        if (biDirectionalLinksModeElement.value === sMaps.IS_USE.yes){
          if (!subjectPathElement.value){
            await sApi.pushErrMsg("请确认必填项是否全部配置！")
            return;
          }
        }

        // 保存设置数据
        let configData = this.data[STORAGE_NAME];

        configData.baseUrl = baseUrlElement.value;
        configData.accessToken = accessTokenElement.value;
        configData.lastSyncTime = lastSyncTimeElement.value;
        configData.syncMode = syncModeElement.value;
        configData.notebookId = notebookIdElement.value;
        configData.pagePath = pagePathElement.value;
        configData.markMode = markModeElement.value;
        configData.imageLayout = imageLayoutElement.value;
        configData.superLabelMode = superLabelModeElement.value;
        configData.superLabelText = superLabelTextElement.value;
        configData.resourceDownloadMode = resourceDownloadModeElement.value;
        configData.biDirectionalLinksMode = biDirectionalLinksModeElement.value;
        configData.subjectPath = subjectPathElement.value;

        await this.saveData(STORAGE_NAME, configData);

        // 生成Memos对象
        this.memosService = new mApi(configData.baseUrl, configData.accessToken);
      }
    });

    // 添加校验按钮
    this.setting.addItem({
      title: "Access Token 校验",
      description: "检查能否访问 Memos",
      createActionElement: () => {
        checkButtonElement.className = "b3-button b3-button--outline fn__flex-center";
        checkButtonElement.textContent = "校验";
        return checkButtonElement;
      },
    });

    // 按钮绑定事件
    checkButtonElement.addEventListener('click', async () => {
      await this.checkAccessToken(baseUrlElement.value, accessTokenElement.value, true);  // 校验 Access Token
    });

    // 添加基础路径输入框
    this.setting.addItem({
      title: "服务器地址 <code class='fn__code'><font color='red'>必填项</font></code>",
      description: "允许使用域名或者IP地址，地址最后不要保留 '/'",
      createActionElement: () => {
        baseUrlElement.className = "b3-text-field fn__size350 fn__flex-center";
        baseUrlElement.value = this.data[STORAGE_NAME].baseUrl;
        return baseUrlElement;
      },
    });

    // 添加授权码输入框
    this.setting.addItem({
      title: "授权码 <code class='fn__code'><font color='red'>必填项</font></code>",
      description: "请在设置页面获取 Access Token",
      createActionElement: () => {
        accessTokenElement.className = "b3-text-field fn__size350 fn__flex-center";
        accessTokenElement.value = this.data[STORAGE_NAME].accessToken;
        return accessTokenElement;
      },
    });

    // 添加上次同步时间输入框
    this.setting.addItem({
      title: "上次同步时间 <code class='fn__code'><font color='red'>必填项</font></code>",
      description: `同步完成后会自动更新，如有特殊需要可以手动修改`,
      createActionElement: () => {
        lastSyncTimeElement.className = "b3-text-field fn__size200 fn__flex-center fn__block";
        lastSyncTimeElement.value = this.data[STORAGE_NAME].lastSyncTime;
        return lastSyncTimeElement;
      },
    });

    // 添加同步方案下拉框
    this.setting.addItem({
      title: "同步方案 <code class='fn__code'><font color='red'>必填项</font></code>",
      description: "1. 同步至 Daily Notes：需要配置笔记本，文档路径无效<br>2. 同步至笔记本或文档下：需要配置笔记本，如需保存至指定文档下需要配置文档路径<br>3. 同步至单个文档中：需要配置笔记本和文档路径",
      createActionElement: () => {
        syncModeElement = document.createElement('select')
        syncModeElement.className = "b3-select fn__flex-center fn__size200";
        let options = [
          {
            value: sMaps.SYNC_MAP.block,
            text: "同步至 Daily Notes"
          },
          {
            value: sMaps.SYNC_MAP.page,
            text: "同步至笔记本或文档下"
          },
          {
            value: sMaps.SYNC_MAP.simple,
            text: "同步至单份文档中"
          }
        ]
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.value;
          optionElement.text = option.text;
          syncModeElement.appendChild(optionElement);
        }
        syncModeElement.value = this.data[STORAGE_NAME].syncMode;
        return syncModeElement;
      }
    });

    // 添加笔记本下拉框
    this.nowNotebooks = await this.getNotebooks();
    this.setting.addItem({
      title: "笔记本 <code class='fn__code'><font color='red'>必填项</font></code>",
      description: "选择保存的笔记本",
      createActionElement: () => {
        notebookIdElement = document.createElement('select')
        notebookIdElement.className = "b3-select fn__flex-center fn__size200";
        let options = this.nowNotebooks;
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.value;
          optionElement.text = option.text;
          notebookIdElement.appendChild(optionElement);
        }
        notebookIdElement.value = this.data[STORAGE_NAME].notebookId;
        return notebookIdElement;
      },
    });

    // 添加文档路径输入框
    this.setting.addItem({
      title: "文档路径",
      description: "如需保存至指定文档下，请以'/'开头进行填写",
      createActionElement: () => {
        pagePathElement.className = "b3-text-field fn__size200 fn__flex-center";
        pagePathElement.value = this.data[STORAGE_NAME].pagePath;
        return pagePathElement;
      },
    });

    // 添加引用处理方案下拉框
    this.setting.addItem({
      title: "引用处理方案",
      description: "Memos的引用在思源的保存方案处理",
      createActionElement: () => {
        markModeElement = document.createElement('select')
        markModeElement.className = "b3-select fn__flex-center fn__size200";
        let options = [
          {
            val: sMaps.MARK_MAP.blockRef,
            text: "引用块"
          },
          {
            val: sMaps.MARK_MAP.blockEmbed,
            text: "嵌入块"
          }
        ]
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.val;
          optionElement.text = option.text;
          markModeElement.appendChild(optionElement);
        }
        markModeElement.value = this.data[STORAGE_NAME].markMode;
        return markModeElement;
      }
    });

    // 图片布局处理方案
    this.setting.addItem({
      title: "图片块布局",
      description: "Memos的图片在思源的保存方案处理",
      createActionElement: () => {
        imageLayoutElement = document.createElement('select')
        imageLayoutElement.className = "b3-select fn__flex-center fn__size200";
        let options = [
          {
            val: sMaps.IMAGE_LAYOUT.direction,
            text: "纵向布局"
          },
          {
            val: sMaps.IMAGE_LAYOUT.transverse,
            text: "横向布局"
          }
        ]
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.val;
          optionElement.text = option.text;
          imageLayoutElement.appendChild(optionElement);
        }
        imageLayoutElement.value = this.data[STORAGE_NAME].imageLayout;
        return imageLayoutElement;
      }
    });

    // 识别双链符号控件
    this.setting.addItem({
      title: "是否识别双向链接符号",
      description: "识别双向链接符号并自动关联文档<br><font color='red'>请注意：只支持文档块的匹配</fonts>",
      createActionElement: () => {
        biDirectionalLinksModeElement = document.createElement('select')
        biDirectionalLinksModeElement.className = "b3-select fn__flex-center fn__size200";
        let options = [
          {
            val: sMaps.IS_USE.no,
            text: "否"
          },
          {
            val: sMaps.IS_USE.yes,
            text: "是"
          }
        ]
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.val;
          optionElement.text = option.text;
          biDirectionalLinksModeElement.appendChild(optionElement);
        }
        biDirectionalLinksModeElement.value = this.data[STORAGE_NAME].biDirectionalLinksMode;
        return biDirectionalLinksModeElement;
      }
    });
    
    // 主题路径
    this.setting.addItem({
      title: "主题路径",
      description: "保存自动创建的主题文档路径，请以'/'开头进行填写",
      createActionElement: () => {
        subjectPathElement.className = "b3-text-field fn__size200 fn__flex-center";
        subjectPathElement.value = this.data[STORAGE_NAME].subjectPath;
        return subjectPathElement;
      },
    });

    // 是否使用上级标签
    this.setting.addItem({
      title: "是否增加上级标签",
      description: "为所有的标签增加一个上级标签",
      createActionElement: () => {
        superLabelModeElement = document.createElement('select')
        superLabelModeElement.className = "b3-select fn__flex-center fn__size200";
        let options = [
          {
            val: sMaps.IS_USE.no,
            text: "否"
          },
          {
            val: sMaps.IS_USE.yes,
            text: "是"
          }
        ]
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.val;
          optionElement.text = option.text;
          superLabelModeElement.appendChild(optionElement);
        }
        superLabelModeElement.value = this.data[STORAGE_NAME].superLabelMode;
        return superLabelModeElement;
      }
    });

    // 上级标签输入框
    this.setting.addItem({
      title: "标签名称",
      description: "设置上级标签名称，请确认标签开头和结尾没有'/'",
      createActionElement: () => {
        superLabelTextElement.className = "b3-text-field fn__size200 fn__flex-center";
        superLabelTextElement.value = this.data[STORAGE_NAME].superLabelText;
        return superLabelTextElement;
      },
    });

    // 资源下载方式
    this.setting.addItem({
      title: "资源下载模式",
      description: "当资源无法正确显示或下载时请选择使用第二种模式",
      createActionElement: () => {
        resourceDownloadModeElement = document.createElement('select')
        resourceDownloadModeElement.className = "b3-select fn__flex-center fn__size200";
        let options = [
          {
            val: sMaps.RESOURCE_DOWNLOAD_MODE.first,
            text: "第一种"
          },
          {
            val: sMaps.RESOURCE_DOWNLOAD_MODE.second,
            text: "第二种"
          }
        ]
        for (let option of options) {
          let optionElement = document.createElement('option');
          optionElement.value = option.val;
          optionElement.text = option.text;
          resourceDownloadModeElement.appendChild(optionElement);
        }
        resourceDownloadModeElement.value = this.data[STORAGE_NAME].resourceDownloadMode;
        return resourceDownloadModeElement;
      }
    });

    await this.checkNew();  // 检查是否有新数据
  }

  async openSetting() {
    this.nowNotebooks = await this.getNotebooks();
    super.openSetting();
  }

  async onunload() {
    this.eventBus.off("sync-end", this.eventBusHandler.bind(this));
    this.syncing = false;
  }

  async onLayoutReady() {
    await this.checkAccessToken();
  }

  /**
   * 将回调变为异步函数
   * @param callFun 
   * @param success 
   * @param fail 
   * @param args 
   * @returns 
   */
  async waitFunction(callFun, success, fail, ...args) {
    return new Promise((resolve) => {
      callFun(...args, (...result) => {
        resolve(success(...result));
      }, (...result) => {
        resolve(fail(...result));
      });
    });
  }
}