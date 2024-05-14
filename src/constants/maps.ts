export const configMaps = {
    // 是否使用
    IS_USE: {
        no: '0',
        yes: '1'
    },

    // 同步保存方案
    SYNC_MAP: {
        block: "0", // 同步至 Daily Notes
        page: "1",  // 同步至笔记本或文档下
        simple: "2" // 同步至单份文档中
    },

    // 引用处理方案
    MARK_MAP: {
        blockRef: "0",  // 引用块
        blockEmbed: "1" // 嵌入块
    },

    // 图片布局
    IMAGE_LAYOUT: {
        direction: '0', // 纵向布局
        transverse: '1' // 横向布局
    },

    //
    RESOURCE_DOWNLOAD_MODE: {
        first: '1',
        second: '2',
        third: '3'
    },

    // 标签匹配范围
    TAGS_AREA: {
        full: '1',
        last: '2'
    }
}
