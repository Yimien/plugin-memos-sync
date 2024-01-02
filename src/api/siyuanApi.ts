import {
    fetchPost,
    fetchSyncPost
} from "siyuan";

/**
 * 思源API
 */
export class SiyuanApi {
    /**
     * 获取持久化的本地存储数据
     * @returns 
     */
    static async getLocalStorage() {
        return await fetchSyncPost("/api/storage/getLocalStorage");
    }

    /**
     * 列出所有笔记本
     * @returns 
     */
    static async lsNotebooks() {
        return await fetchSyncPost("/api/notebook/lsNotebooks");
    }

    /**
     * 获取笔记本配置
     * @param notebookId - 笔记本ID
     * @returns 
     */
    static async getNotebookConf(notebookId: string) {
        return await fetchSyncPost("/api/notebook/getNotebookConf", {
            notebook: notebookId
        });
    }

    /**
     * 通过 Markdown 创建文档
     * @param notebook - 笔记本ID
     * @param path - 可读路径
     * @returns
     */
    static async createDocWithMd(notebook: string, path: string, markdown: string) {
        return await fetchSyncPost("/api/filetree/createDocWithMd", {
            notebook: notebook,
            path: path,
            markdown: markdown
        });
    }

    /**
     * 通过文档路径获取下级文档列表
     * @param notebook - 笔记本ID
     * @param path - 可读路径
     * @returns
     */
    static async getIDsByHPath(notebook: string, path: string) {
        return await fetchSyncPost("/api/filetree/getIDsByHPath", {
            notebook: notebook,
            path: path
        });
    }

    /**
     * 在下级块尾部插入块
     * @param parentID - 父块的 ID，用于锚定插入位置
     * @param content - 待插入的数据
     * @param dataType - 待插入数据类型，值可选择 markdown 或者 dom
     * @returns 
     */
    static async appendBlock(parentID: string, content: string, dataType = 'markdown') {
        return await fetchSyncPost("/api/block/appendBlock", {
            parentID: parentID,
            data: content,
            dataType: dataType
        });
    }

    /**
     * 删除块
     * @param id - 待删除块的 ID
     * @returns 
     */
    static async deleteBlock(id: string) {
        return await fetchSyncPost("/api/block/deleteBlock", {
            id: id
        });
    }

    /**
     * 获取下级块
     * @param id - 父块 ID
     * @returns 
     */
    static async getChildBlocks(id: string) {
        return await fetchSyncPost("/api/block/getChildBlocks", {
            id: id
        });
    }

    /**
     * 写入文件
     * @param path - 工作空间路径下的文件路径
     * @param file - 上传的文件
     * @param isDir - 是否为创建文件夹，为 true 时仅创建文件夹，忽略 file
     * @returns 
     */
    static async putFile(path: string, file, isDir = 'false') {
        const fd = new FormData();
        fd.append('path', path);
        fd.append('file', file);
        fd.append('isDir', isDir);
        return await fetch('/api/file/putFile', {
            method: 'POST',
            body: fd
        });
    }

    /**
     * 设置块属性
     * @param id - 块 ID
     * @param attrs - 块属性，自定义属性必须以 custom- 作为前缀
     * @returns 
     */
    static async setBlockAttrs(id: string, attrs: { [key: string]: null | string }) {
        return await fetchSyncPost("/api/attr/setBlockAttrs", {
            id: id,
            attrs: attrs
        });
    }

    /**
     * 渲染 Sprig 模板字符串
     * @param template - 模板字符串
     */
    static async renderSprig(template) {
        return await fetchSyncPost("/api/template/renderSprig", {
            template: template
        });
    }

    /**
     * SQL查询
     * @param sql - sql语句
     * @returns 
     */
    static async querySql(sql) {
        return await fetchSyncPost("/api/query/sql", {
            stmt: sql
        });
    }

    /**
     * 推送消息
     * @param message - 消息
     */
    static async pushMsg(message) {
        fetchPost("/api/notification/pushMsg", {
            msg: message
        });
    }

    /**
     * 推送报错消息
     * @param message - 消息
     */
    static async pushErrMsg(message) {
        fetchPost("/api/notification/pushErrMsg", {
            msg: message
        });
    }

    /**
     * 判断请求是否成功
     * @param response - 响应信息
     * @returns 
     */
    static async isOK(response) {
        return (response.code == '0') ? true : false;
    }

}