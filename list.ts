import { DataSource } from '@angular/cdk/collections';
import { HttpParams } from '@angular/common/http';
import {
  ChangeDetectorRef,
  ComponentFactoryResolver,
  EventEmitter,
  Inject,
  Input,
  OnDestroy,
  OnInit,
  AfterViewInit,
  Output,
  QueryList,
  Type,
  ViewChild,
  ViewChildren,
  ViewContainerRef,
} from '@angular/core';
import { MatPaginator, MatSort, MatTableDataSource } from '@angular/material';
import { Router } from '@angular/router';
import { Event as KdEvent, Resource, ResourceList } from '@api/symui';
import {
  ActionColumn,
  ActionColumnDef,
  ColumnWhenCallback,
  ColumnWhenCondition,
  OnListChangeEvent,
} from '@api/symui';
import { Subject } from 'rxjs';
import { Observable, ObservableInput } from 'rxjs/Observable';
import { merge } from 'rxjs/observable/merge';
import { startWith, switchMap, takeUntil } from 'rxjs/operators';

// import { SEARCH_QUERY_STATE_PARAM } from '../params/params';
import { KdStateService } from '@service/global/state.service';
import { LocaltionService } from '@service/global/localtion.service';
import { CardListFilterComponent } from '../components/list/filter/filter.component';
import { NotificationsService } from '@service/global/notifications.service';
import { GlobalServicesModule } from '@service/global/global.module';
import { RowDetailComponent } from '../components/list/rowdetail/rowdetail.component';
import { ConfigService } from '@service/global/config.service';

export abstract class ResourceListBase<T extends ResourceList, R extends Resource>
  implements OnInit, OnDestroy, AfterViewInit {
  // Base properties
  private readonly actionColumns_: Array<ActionColumnDef<ActionColumn>> = [];
  public readonly data_ = new MatTableDataSource<R>();
  private listUpdates_ = new Subject();
  private unsubscribe_ = new Subject<void>();
  private loaded_ = false;
  private readonly dynamicColumns_: ColumnWhenCondition[] = [];
  // private paramsService_: ParamsService;
  private router_: Router;
  protected readonly kdState_: KdStateService;
  protected readonly settingsService_: ConfigService;
  // protected readonly namespaceService_: NamespaceService;
  protected readonly localtionService_: LocaltionService;

  isLoading = false;
  totalItems = 0;

  get itemsPerPage(): number {
    return this.settingsService_.getItemsPerPage();
  }

  @Output('onchange') onChange: EventEmitter<OnListChangeEvent> = new EventEmitter();

  @Input() groupId: string;
  @Input() hideable = false;
  @Input() id: string;

  // Data select properties
  @ViewChild(MatSort, { static: false }) private readonly matSort_: MatSort;
  @ViewChild(MatPaginator, { static: false }) private readonly matPaginator_: MatPaginator;
  @ViewChild(CardListFilterComponent, { static: false })
  private readonly cardFilter_: CardListFilterComponent;

  protected constructor(
    private readonly stateName_: string,
    private readonly notifications_: NotificationsService,
    private readonly cdr_: ChangeDetectorRef,
  ) {
    // this.settingsService_ = GlobalServicesModule.injector.get(GlobalSettingsService);
    this.kdState_ = GlobalServicesModule.injector.get(KdStateService);
    // this.namespaceService_ = GlobalServicesModule.injector.get(NamespaceService);
    // this.paramsService_ = GlobalServicesModule.injector.get(ParamsService);
    this.router_ = GlobalServicesModule.injector.get(Router);
    this.localtionService_ = GlobalServicesModule.injector.get(LocaltionService);
    this.settingsService_ = GlobalServicesModule.injector.get(ConfigService);
  }

  ngOnInit(): void {
    if (!this.id) {
      throw Error('ID is a required attribute of list component.');
    }

    this.getList();

    // if (this.matPaginator_ === undefined) {
    //   throw Error('MatPaginator has to be defined on a table.');
    // }

    // this.namespaceService_.onNamespaceChangeEvent.subscribe(() => {
    //   this.isLoading = true;
    //   this.listUpdates_.next();
    // });

    // this.paramsService_.onParamChange.subscribe(() => {
    //   this.isLoading = true;
    //   this.listUpdates_.next();
    // });
  }

  ngAfterViewInit(): void {
    this.data_.sort = this.matSort_;
    this.data_.paginator = this.matPaginator_;

    if (this.cardFilter_) {
      // 表格搜索
      this.cardFilter_.filterEvent.subscribe(() => {
        const filterValue = this.cardFilter_.query;
        this.data_.filter = filterValue.trim().toLowerCase();
      });
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe_.next();
    this.unsubscribe_.complete();
  }

  getDetailsHref(resourceName: string, namespace?: string): string {
    return this.stateName_ ? this.kdState_.href(this.stateName_, resourceName,
      this.localtionService_.current().project + '-' + namespace) : '';
  }

  getParams() {
    return {
      cluster: this.localtionService_.current().cluster
    };
  }

  getData(): DataSource<R> {
    return this.data_;
  }

  getList() {
    this.getObservableWithDataSelect_()
      .pipe(startWith({}))
      .pipe(
        switchMap(() => {
          this.isLoading = true;
          if (this.cdr_) {
            this.cdr_.markForCheck();
            this.cdr_.detectChanges();
          }
          // 暂时去掉排序分页参数
          // return this.getResourceObservable(this.getDataSelectParams_());
          return this.getResourceObservable();
        }),
      )
      .pipe(takeUntil(this.unsubscribe_))
      .subscribe((data: T) => {
        this.notifications_.pushErrors(data.errors);
        this.data_.data = this.map(data);
        this.totalItems = data.listMeta.totalItems;
        this.isLoading = false;
        this.loaded_ = true;

        this.onListChange_(data);

        if (this.cdr_) {
          this.cdr_.detectChanges();
        }
      });
  }

  showZeroState(): boolean {
    return this.totalItems === 0 && !this.isLoading;
  }

  isHidden(): boolean {
    return this.hideable && !this.filtered_() && this.showZeroState();
  }

  getColumns(): string[] {
    const displayColumns = this.getDisplayColumns();
    const actionColumns = this.actionColumns_.map(col => col.name);

    for (const condition of this.dynamicColumns_) {
      if (condition.whenCallback()) {
        const afterColIdx = displayColumns.indexOf(condition.afterCol);
        displayColumns.splice(afterColIdx + 1, 0, condition.col);
      }
    }

    return displayColumns.concat(...actionColumns);
  }

  getActionColumns(): Array<ActionColumnDef<ActionColumn>> {
    return this.actionColumns_;
  }

  shouldShowColumn(dynamicColName: string): boolean {
    const col = this.dynamicColumns_.find(condition => {
      return condition.col === dynamicColName;
    });
    if (col !== undefined) {
      return col.whenCallback();
    }

    return false;
  }

  protected registerActionColumn<C extends ActionColumn>(name: string, component: Type<C>): void {
    this.actionColumns_.push({
      name: `action-${name}`,
      component,
    } as ActionColumnDef<ActionColumn>);
  }

  protected registerDynamicColumn(
    col: string,
    afterCol: string,
    whenCallback: ColumnWhenCallback,
  ): void {
    this.dynamicColumns_.push({
      col,
      afterCol,
      whenCallback,
    } as ColumnWhenCondition);
  }

  private getObservableWithDataSelect_<E>(): Observable<E> {
    // const obsInput = [this.matPaginator_.page] as Array<ObservableInput<E>>;
    const obsInput = [] as Array<ObservableInput<E>>;

    // 暂时去掉排序请求
    // if (this.matSort_) {
    //   this.matSort_.sortChange.subscribe(() => (this.matPaginator_.pageIndex = 0));
    //   obsInput.push(this.matSort_.sortChange);
    // }

    // 暂时去掉字段过滤
    // if (this.cardFilter_) {
      // this.cardFilter_.filterEvent.subscribe(() => (this.matPaginator_.pageIndex = 0));
      // obsInput.push(this.cardFilter_.filterEvent);
    // }

    return merge(...obsInput, this.listUpdates_ as Subject<E>);
  }

  private getDataSelectParams_(): HttpParams {
    let params = this.paginate_();

    if (this.matSort_) {
      params = this.sort_(params);
    }

    if (this.cardFilter_) {
      params = this.filter_(params);
    }

    return this.search_(params);
  }

  private sort_(params?: HttpParams): HttpParams {
    let result = new HttpParams();
    if (params) {
      result = params;
    }

    return result.set('sortBy', this.getSortBy_());
  }

  private paginate_(params?: HttpParams): HttpParams {
    let result = new HttpParams();
    if (params) {
      result = params;
    }

    return result
      .set('itemsPerPage', `${this.itemsPerPage}`)
      .set('page', `${this.matPaginator_.pageIndex + 1}`);
  }

  private filter_(params?: HttpParams): HttpParams {
    let result = new HttpParams();
    if (params) {
      result = params;
    }

    const filterByQuery = this.cardFilter_.query ? `name,${this.cardFilter_.query}` : '';
    if (filterByQuery) {
      return result.set('filterBy', filterByQuery);
    }

    return result;
  }

  private search_(params?: HttpParams): HttpParams {
    let result = new HttpParams();
    if (params) {
      result = params;
    }

    const filterByQuery = result.get('filterBy') || '';
    if (this.router_.routerState.snapshot.url.startsWith('/search')) {
      // const query = this.paramsService_.getQueryParam(SEARCH_QUERY_STATE_PARAM);
      // if (query) {
      //   if (filterByQuery) {
      //     filterByQuery += ',';
      //   }
      //   filterByQuery += `name,${query}`;
      // }
    }

    if (filterByQuery) {
      return result.set('filterBy', filterByQuery);
    }
    return result;
  }

  private filtered_(): boolean {
    return !!this.filter_().get('filterBy');
  }

  private getSortBy_(): string {
    // Default values.
    let ascending = true;
    let active = 'age';

    if (this.matSort_.direction) {
      ascending = this.matSort_.direction === 'asc';
    }

    if (this.matSort_.active) {
      active = this.matSort_.active;
    }

    if (active === 'age') {
      ascending = !ascending;
    }

    return `${ascending ? 'a' : 'd'},${this.mapToBackendValue_(active)}`;
  }

  private mapToBackendValue_(sortByColumnName: string): string {
    return sortByColumnName === 'age' ? 'creationTimestamp' : sortByColumnName;
  }

  private onListChange_(data: T): void {
    const emitValue = {
      id: this.id,
      groupId: this.groupId,
      items: this.totalItems,
      filtered: false,
      resourceList: data,
    } as OnListChangeEvent;

    if (this.cardFilter_) {
      emitValue.filtered = this.filtered_();
    }

    this.onChange.emit(emitValue);
  }

  protected abstract getDisplayColumns(): string[];

  abstract getResourceObservable(params?: HttpParams): Observable<T>;

  abstract map(value: T): R[];
}

export abstract class ResourceListWithStatuses<
  T extends ResourceList,
  R extends Resource
  > extends ResourceListBase<T, R> {
  private readonly bindings_: { [hash: number]: StateBinding<R> } = {};
  @ViewChildren('matrow', { read: ViewContainerRef })
  private readonly containers_: QueryList<ViewContainerRef>;
  private lastHash_: number;
  private readonly unknownStatus: StatusIcon = {
    iconName: 'help',
    iconClass: { '': true },
  };

  protected icon = IconName;

  expandedRow: number = undefined;
  hoveredRow: number = undefined;

  protected constructor(
    stateName: string,
    private readonly notifications: NotificationsService,
    cdr: ChangeDetectorRef,
    private readonly resolver_?: ComponentFactoryResolver,
  ) {
    super(stateName, notifications, cdr);

    this.onChange.subscribe(this.clearExpandedRows_.bind(this));
  }

  expand(index: number, resource: R): void {
    if (!this.hasErrors(resource)) {
      return;
    }

    if (this.expandedRow !== undefined) {
      this.containers_.toArray()[this.expandedRow].clear();
    }

    if (this.expandedRow === index) {
      this.expandedRow = undefined;
      return;
    }

    const container = this.containers_.toArray()[index];
    const factory = this.resolver_.resolveComponentFactory(RowDetailComponent);
    const component = container.createComponent(factory);

    component.instance.events = this.getEvents(resource);
    this.expandedRow = index;
  }


  compare(a: number | string, b: number | string, isAsc: boolean) {
    return (a < b ? -1 : 1) * (isAsc ? 1 : -1);
  }

  getStatus(resource: R): StatusIcon {
    if (this.lastHash_) {
      const stateBinding = this.bindings_[this.lastHash_];
      if (stateBinding.callbackFunction(resource)) {
        return this.getStatusObject_(stateBinding);
      }
    }

    // map() is needed here to cast hash from string to number. Without it compiler will not
    // recognize stateBinding type.
    for (const hash of Object.keys(this.bindings_).map((hashStr): number => Number(hashStr))) {
      const stateBinding = this.bindings_[hash];
      if (stateBinding.callbackFunction(resource)) {
        this.lastHash_ = Number(hash);
        return this.getStatusObject_(stateBinding);
      }
    }

    return this.unknownStatus;
  }

  isRowExpanded(index: number): boolean {
    return this.expandedRow === index;
  }

  isRowHovered(index: number): boolean {
    return this.hoveredRow === index;
  }

  onRowOver(rowIdx: number): void {
    this.hoveredRow = rowIdx;
  }

  onRowLeave(): void {
    this.hoveredRow = undefined;
  }

  showHoverIcon(index: number, resource: R): boolean {
    return this.isRowHovered(index) && this.hasErrors(resource) && !this.isRowExpanded(index);
  }

  protected getEvents(_resource: R): KdEvent[] {
    return [];
  }

  protected hasErrors(_resource: R): boolean {
    return false;
  }

  protected registerBinding(
    iconName: IconName,
    iconClass: string,
    callbackFunction: StatusCheckCallback<R>,
  ): void {
    const icon = new Icon(String(iconName), iconClass);
    this.bindings_[icon.hash()] = { icon, callbackFunction };
  }

  private clearExpandedRows_(): void {
    const containers = this.containers_.toArray();
    for (let i = 0; i < containers.length; i++) {
      containers[i].clear();
      this.expandedRow = undefined;
    }
  }

  private getStatusObject_(stateBinding: StateBinding<R>): StatusIcon {
    return {
      iconName: stateBinding.icon.name,
      iconClass: { [stateBinding.icon.cssClass]: true },
    };
  }
}

interface StatusIcon {
  iconName: string;
  iconClass: { [className: string]: boolean };
}

enum IconName {
  error = 'error',
  timelapse = 'timelapse',
  checkCircle = 'check_circle',
  help = 'help',
  warning = 'warning',
  none = '',
}

class Icon {
  name: string;
  cssClass: string;

  constructor(name: string, cssClass: string) {
    this.name = name;
    this.cssClass = cssClass;
  }

  /**
   * Implementation of djb2 hash function:
   * http://www.cse.yorku.ca/~oz/hash.html
   */
  hash(): number {
    const value = `${this.name}#${this.cssClass}`;
    return value
      .split('')
      .map(str => {
        return str.charCodeAt(0);
      })
      .reduce((prev, curr) => {
        return (prev << 5) + prev + curr;
      }, 5381);
  }
}

type StatusCheckCallback<T> = (resource: T) => boolean;

interface StateBinding<T> {
  icon: Icon;
  callbackFunction: StatusCheckCallback<T>;
}
