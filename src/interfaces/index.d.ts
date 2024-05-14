export interface IBlockIdMaps{
    memoId: string,
    block: string
}

export interface IMemo {
    memoId: string,
    title: string,
    content: string,
    contentText: string,
    contentLink: string,
    resourceList,
    relationList,
    dispalyDate: string,
    displayts: string
}

export interface IGroupedData {
    [key: string]: IMemo[];
}