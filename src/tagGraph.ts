
// tagGraph.ts
// import * as d3 from 'd3';


// const d3 = window.d3;
interface Tag {
    tag_id: number;
    name: string;
    readable_id: string;
    children: Tag[];
    visible: boolean;
    x?: number;
    y?: number;
    fx?: number | null;
    fy?: number | null;
    generation?: number;
}


interface Link {
    source: Tag;
    target: Tag;
}

const IS_PROD = true
const fetchpath = IS_PROD ? "/dynotes" : "";

class TagGraph {
    private container: HTMLElement;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private simulation: d3.Simulation<Tag, Link>;
    private nodes: Tag[];
    private links: Link[];
    private draggedNode: Tag | null;
    private selectedNodes: Set<Tag>;
    private lastSelectedNode: Tag | null;
    private infoText: d3.Selection<SVGTextElement, unknown, null, undefined>;
    private pointerCounts: Map<number, number> = new Map();
    private isDragging: boolean = false;
    private holdTimer: number | null = null;
    private isHoldReady: boolean = false;
    private nodeMenu: HTMLElement;

    private static readonly COLORS = {
        ARROW: "#2c3e50",
        NODE_STROKE: "#3498db",

        NODE_UNSELECTED: [
            "#2d3436",  // Generation 0
            "#636e72",  // Generation 1
            "#b2bec3",  // Generation 2
            "#dfe6e9",  // Generation 3
        ],
        NODE_SELECTED: [
            "#d35400",  // Generation 0
            "#e67e22",  // Generation 1
            "#f39c12",  // Generation 2
            "#f1c40f",  // Generation 3
        ],
        // BACKGROUND: "#FFF5E6",  // Sepia whitef7f1e3
        BACKGROUND: "#f7f1e3",  // Sepia whitef7f1e3
        // BORDER: "#D4C6B3"       // Slightly darker than background for border
        BORDER: "#84817a"       // Slightly darker than background for border
    };
    private static readonly GRAPH_HEIGHT = 800;

    private static readonly NODE_SIZES = [15, 13, 11, 9];  // Sizes for generations 0-4+

    constructor(containerId: string) {
        this.updateNodeMenu()
        this.container = document.getElementById(containerId)!;

        // Apply styles to the container
        this.container.style.backgroundColor = TagGraph.COLORS.BACKGROUND;
        this.container.style.border = `2px solid ${TagGraph.COLORS.BORDER}`;

        this.nodeMenu = document.getElementById('nodeMenu')!;
        document.getElementById('closeNodeMenu')!.addEventListener('click', () => this.hideNodeMenu());

        const padding = 10; // Padding from the edges

        this.svg = d3.select(this.container).append("svg")
            .attr("width", "100%")
            .attr("height", TagGraph.GRAPH_HEIGHT + "px");
        this.simulation = d3.forceSimulation<Tag>()
            .force("link", d3.forceLink<Tag, Link>().id(d => d.tag_id.toString()).distance(this.getLinkDistance.bind(this)))
            .force("charge", d3.forceManyBody().strength(-150))
            .force("center", d3.forceCenter(this.container.clientWidth / 2, TagGraph.GRAPH_HEIGHT / 2))
            .force("collision", d3.forceCollide().radius(20))
            .force("x", d3.forceX(this.container.clientWidth / 2).strength(0.05))
            .force("y", d3.forceY(250).strength(0.05))
            .force("bound", () => {
                for (let node of this.simulation.nodes()) {
                    node.x = Math.max(padding, Math.min(this.container.clientWidth - padding, node.x!));
                    node.y = Math.max(padding, Math.min(TagGraph.GRAPH_HEIGHT - padding, node.y!));
                }
            });
        this.nodes = [];
        this.links = [];
        this.draggedNode = null;
        this.selectedNodes = new Set<Tag>();
        this.lastSelectedNode = null;
        this.infoText = this.svg.append("text")
            .attr("id", "infoText")
            .attr("x", this.container.clientWidth / 2)
            .attr("y", 30)
            .attr("text-anchor", "middle")
            .attr("fill", "#333")
            .style("font-size", "14px")
            .style("font-weight", "bold");
        // Add CSS rule to prevent text selection
        const style = document.createElement('style');
        style.textContent = `
            .node text {
                -webkit-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
        window.addEventListener('resize', () => {
            requestAnimationFrame(() => {
                this.updateSimulationForces();
            });
        });
        this.updateSimulationForces();

    }

    updateSimulationForces(): void {
        const centerX = this.container.clientWidth / 2;
        const centerY = TagGraph.GRAPH_HEIGHT / 2;

        this.simulation
            .force("center", d3.forceCenter(centerX, centerY))
            .force("x", d3.forceX(centerX).strength(0.075))
            .force("y", d3.forceY(centerY).strength(0.075));

        // Restart the simulation with a higher alpha to make the changes more apparent
        this.simulation.alpha(0.3).restart();
    }


    hideNodeMenu(): void {
        this.nodeMenu.style.display = 'none';
        this.lastSelectedNode = null;
        requestAnimationFrame(() => {
            this.updateSimulationForces();
        });
    }

    isOrphan(node: Tag): boolean {
        return !this.links.some(link => link.target === node);
    }

    async deleteTag(tagId: number): Promise<void> {
        if (!confirm("Are you sure you want to delete this tag? This action cannot be undone.")) {
            return;
        }

        try {
            const response = await fetch(fetchpath + '/delete_tag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag_id: tagId })
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    // Remove the tag from the nodes array
                    this.nodes = this.nodes.filter(node => node.tag_id !== tagId);

                    // Remove any links associated with this tag
                    this.links = this.links.filter(link => link.source.tag_id !== tagId && link.target.tag_id !== tagId);

                    // Clear the selected node if it was the deleted tag
                    if (this.lastSelectedNode && this.lastSelectedNode.tag_id === tagId) {
                        this.lastSelectedNode = null;
                    }

                    // Remove the tag from selectedNodes if present
                    this.selectedNodes.delete(this.nodes.find(node => node.tag_id === tagId)!);

                    this.updateGraph();
                    this.updateNodeMenu();
                    this.updateSelectedTagsLists();
                    alert('Tag deleted successfully!');
                } else {
                    alert('Failed to delete tag: ' + result.error);
                }
            } else {
                const errorData = await response.json();
                alert('Failed to delete tag: ' + errorData.error);
            }
        } catch (error) {
            console.error('Error deleting tag:', error);
            alert('Error deleting tag: ' + error);
        }
    }

    async loadData(): Promise<void> {
        const [tagsResponse, relationshipsResponse] = await Promise.all([
            fetch(fetchpath + '/tags'),
            fetch(fetchpath + '/tag_relationships')
        ]);
        const tags: Tag[] = await tagsResponse.json();
        const relationships: { parent_tag_id: number, child_tag_id: number }[] = await relationshipsResponse.json();

        this.nodes = tags.map(tag => ({ ...tag, children: [], visible: !relationships.some(r => r.child_tag_id === tag.tag_id) }));
        this.links = relationships.map(rel => ({
            source: this.nodes.find(n => n.tag_id === rel.parent_tag_id)!,
            target: this.nodes.find(n => n.tag_id === rel.child_tag_id)!
        }));

        this.nodes.forEach(node => {
            node.children = this.links.filter(link => link.source === node).map(link => link.target);
        });

        this.nodes.forEach(node => {
            this.pointerCounts.set(node.tag_id, this.isOrphan(node) ? 1 : 0);
        });
        this.calculateGenerations();
        this.updateGraph();
    }

    calculateGenerations(): void {
        const rootNodes = this.nodes.filter(node => !this.links.some(link => link.target === node));
        rootNodes.forEach(node => this.setGeneration(node, 0));
    }

    setGeneration(node: Tag, generation: number): void {
        node.generation = generation;
        this.links
            .filter(link => link.source === node)
            .forEach(link => this.setGeneration(link.target, generation + 1));
    }

    getLinkDistance(link: Link): number {
        const baseDistance = 100;
        const minDistance = 20;
        const sourceGeneration = link.source.generation || 0;

        const linkdists = [90, 70, 50, 30];
        return linkdists[Math.min(sourceGeneration, 3)]
        return Math.max(baseDistance - sourceGeneration * 40, minDistance);
    }

    getNodeColor(node: Tag): string {
        const isSelected = this.selectedNodes.has(node);
        if (isSelected) {
            const generation = Math.min(node.generation || 0, TagGraph.COLORS.NODE_SELECTED.length - 1);
            return TagGraph.COLORS.NODE_SELECTED[generation];
        } else {
            const generation = Math.min(node.generation || 0, TagGraph.COLORS.NODE_UNSELECTED.length - 1);
            return TagGraph.COLORS.NODE_UNSELECTED[generation];
        }
    }

    private startNodeWiggle(element: Element): void {
        d3.select(element)
            .transition()
            .duration(75)
            .attr("transform", "translate(2, 2)")
            .transition()
            .duration(75)
            .attr("transform", "translate(-2, -2)")
            .transition()
            .duration(75)
            .attr("transform", "translate(-2, 2)")
            .transition()
            .duration(75)
            .attr("transform", "translate(2, -2)")
            .on("end", () => {
                if (this.isHoldReady) {
                    this.startNodeWiggle(element);
                }
            });
    }
    private stopNodeWiggle(element: Element): void {
        d3.select(element)
            .interrupt()
            .attr("transform", null);
    }

    drag(): d3.DragBehavior<SVGGElement, Tag, Tag | d3.SubjectPosition> {
        const timeToWiggle = 750;
        let dragTimer: d3.Timer | null = null;
        let targetNode: Tag | null = null;
        return d3.drag<SVGGElement, Tag>()
            .on("start", (event: d3.D3DragEvent<SVGGElement, Tag, Tag>, d: Tag) => {
                this.isDragging = false;
                this.isHoldReady = false;
                if (!event.active) this.simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
                this.draggedNode = d;

                d3.select(event.sourceEvent.target as Element)
                    .attr("r", this.getNodeSize(d) * 1.2)  // Increase size by 20% when dragging
                    .attr("fill", TagGraph.COLORS.NODE_STROKE);

                // Start the hold timer
                console.log("starting timer:")

                this.holdTimer = window.setTimeout(() => {
                    this.isHoldReady = true;
                    this.startNodeWiggle(event.sourceEvent.target as Element);
                    // select node if you hold it for .5 sec


                    dragTimer = d3.timer(() => {
                        if (this.draggedNode && this.isHoldReady) {
                            this.updateInfoText(d, targetNode);
                        }
                    });
                    this.freezeAllNodes()
                }, timeToWiggle);
            })
            .on("drag", (event: d3.D3DragEvent<SVGGElement, Tag, Tag>, d: Tag) => {
                if (!this.isHoldReady) {
                    // If not held long enough, just move the node
                    d.fx = event.x;
                    d.fy = event.y;
                    if (!event.active) this.simulation.alpha(0.3).restart();
                    return;
                }

                this.isDragging = true;
                d.fx = event.x;
                d.fy = event.y;
                if (!event.active) this.simulation.alpha(0.3).restart();
                targetNode = this.getNodeAtPosition(event.x, event.y, d);

                this.svg.selectAll<SVGCircleElement, Tag>(".node circle")
                    .attr("stroke", node => node === targetNode && node !== d ? TagGraph.COLORS.NODE_STROKE : null)
                    .attr("stroke-width", node => node === targetNode && node !== d ? 3 : null);
                // this.updateInfoText(d, targetNode);
            })
            .on("end", (event: d3.D3DragEvent<SVGGElement, Tag, Tag>, d: Tag) => {
                if (this.holdTimer) {
                    clearTimeout(this.holdTimer);
                    this.holdTimer = null;
                }
                if (dragTimer) {
                    dragTimer.stop();
                    dragTimer = null;
                }
                this.stopNodeWiggle(event.sourceEvent.target as Element);

                if (!event.active) this.simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
                if (this.isHoldReady) {
                    this.handleDragEnd(event, d);
                }
                this.unfreezeAllNodes();
                d3.select(event.sourceEvent.target as Element)
                    .attr("r", this.getNodeSize(d))
                    .attr("fill", this.getNodeColor(d));

                this.svg.selectAll<SVGCircleElement, Tag>(".node circle").attr("stroke", null);
                this.infoText.text("");
                this.isDragging = false;
                this.isHoldReady = false;
            });
    }


    freezeAllNodes(): void {
        this.nodes.forEach(node => {
            if (node !== this.draggedNode) {
                node.fx = node.x;
                node.fy = node.y;
            }
        });
    }


    unfreezeAllNodes(): void {
        this.nodes.forEach(node => {
            if (node !== this.draggedNode) {
                node.fx = null;
                node.fy = null;
            }
        });
    }


    toggleNodeSelection(node: Tag): void {
        if (this.selectedNodes.has(node)) {
            this.selectedNodes.delete(node);
            this.updatePointerCounts(node, -1);
        } else {
            this.selectedNodes.add(node);
            this.updatePointerCounts(node, 1);
        }
        node.visible = true;
        // this.lastSelectedNode = node;
        this.updateGraph();
        this.updateSelectedTagsLists();
        this.performSearch();
        // this.updateNodeMenu();
    }

    updatePointerCounts(node: Tag, delta: number): void {
        const relatives = new Set<Tag>();
        this.addAncestors(node, relatives);
        this.addDescendants(node, relatives);

        relatives.forEach(relative => {
            const currentCount = this.pointerCounts.get(relative.tag_id) || 0;
            this.pointerCounts.set(relative.tag_id, currentCount + delta);
            relative.visible = this.pointerCounts.get(relative.tag_id)! > 0;
        });
    }

    addAncestors(node: Tag, relatives: Set<Tag>): void {
        this.links.forEach(link => {
            if (link.target === node && !relatives.has(link.source)) {
                relatives.add(link.source);
                this.addAncestors(link.source, relatives);
            }
        });
    }
    addDescendants(node: Tag, relatives: Set<Tag>): void {
        this.links.forEach(link => {
            if (link.source === node && !relatives.has(link.target)) {
                relatives.add(link.target);
                // this.addDescendants(link.target, relatives);
            }
        });
    }

    updateNodeMenu(): void {
        if (!this.lastSelectedNode) {
            document.getElementById('nodeMenu')!.style.display = 'none';

            return;
        }

        document.getElementById('nodeMenu')!.style.display = 'block';
        (document.getElementById('nodeName') as HTMLInputElement).value = this.lastSelectedNode.name;

        const parentsList = document.getElementById('nodeParents')!;
        const childrenList = document.getElementById('nodeChildren')!;
        parentsList.innerHTML = '';
        childrenList.innerHTML = '';

        this.links.forEach(link => {
            if (link.target === this.lastSelectedNode) {
                const li = document.createElement('li');
                li.textContent = link.source.name;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.classList.add('remove');
                removeBtn.onclick = () => this.removeRelationship(link);
                li.appendChild(removeBtn);
                parentsList.appendChild(li);
            } else if (link.source === this.lastSelectedNode) {
                const li = document.createElement('li');
                li.textContent = link.target.name;
                const removeBtn = document.createElement('button');
                removeBtn.textContent = 'Remove';
                removeBtn.classList.add('remove');
                removeBtn.onclick = () => this.removeRelationship(link);
                li.appendChild(removeBtn);
                childrenList.appendChild(li);
            }
        });

        const addParentSelect = document.getElementById('addParent') as HTMLSelectElement;
        const addChildSelect = document.getElementById('addChild') as HTMLSelectElement;
        addParentSelect.innerHTML = '';
        addChildSelect.innerHTML = '';

        this.nodes.forEach(node => {
            if (node !== this.lastSelectedNode) {
                const parentOption = document.createElement('option');
                parentOption.value = node.tag_id.toString();
                parentOption.textContent = node.name;
                addParentSelect.appendChild(parentOption);

                const childOption = document.createElement('option');
                childOption.value = node.tag_id.toString();
                childOption.textContent = node.name;
                addChildSelect.appendChild(childOption);
            }
        });

        const deleteTagBtn = document.getElementById('deleteTagBtn') as HTMLButtonElement;
        if (deleteTagBtn) {
            deleteTagBtn.onclick = () => {
                if (this.lastSelectedNode) {
                    this.deleteTag(this.lastSelectedNode.tag_id);
                }
            };
        }

        requestAnimationFrame(() => {
            this.updateSimulationForces();
        });
    }

    async renameNode(): Promise<void> {
        const newName = (document.getElementById('nodeName') as HTMLInputElement).value;
        if (this.lastSelectedNode && newName !== this.lastSelectedNode.name) {
            const response = await fetch(fetchpath + '/rename_tag', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag_id: this.lastSelectedNode.tag_id, new_name: newName })
            });

            if (response.ok) {
                this.lastSelectedNode.name = newName;
                this.updateGraph();
                this.updateNodeMenu();
            } else {
                console.error('Failed to rename tag');
            }
        }
    }

    async addParent(): Promise<void> {
        const parentId = (document.getElementById('addParent') as HTMLSelectElement).value;
        const parentNode = this.nodes.find(n => n.tag_id === parseInt(parentId));
        if (parentNode && this.lastSelectedNode) {
            await this.createRelationship(parentNode, this.lastSelectedNode);
        }
    }

    async addChild(): Promise<void> {
        const childId = (document.getElementById('addChild') as HTMLSelectElement).value;
        const childNode = this.nodes.find(n => n.tag_id === parseInt(childId));
        if (childNode && this.lastSelectedNode) {
            await this.createRelationship(this.lastSelectedNode, childNode);
        }
    }

    updateGraph(): void {
        const visibleNodes = this.nodes.filter(n => this.pointerCounts.get(n.tag_id)! > 0 || this.selectedNodes.has(n));
        const visibleLinks = this.links.filter(l => visibleNodes.includes(l.source) && visibleNodes.includes(l.target));

        // Remove all existing elements
        this.svg.selectAll(".link").remove();
        this.svg.selectAll(".node").remove();

        // Draw links first
        const link = this.svg.append("g")
            .attr("class", "links")
            .selectAll<SVGLineElement, Link>("line")
            .data(visibleLinks, d => `${d.source.tag_id}-${d.target.tag_id}`)
            .join("line")
            .attr("class", "link")
            .attr("stroke", TagGraph.COLORS.ARROW)
            .attr("stroke-width", 2)
            .attr("marker-end", "url(#arrowhead)");

        // Then draw nodes on top
        const node = this.svg.append("g")
            .attr("class", "nodes")
            .selectAll<SVGGElement, Tag>("g")
            .data(visibleNodes, d => d.tag_id)
            .join("g")
            .attr("class", "node")
            .attr("data-tag-id", d => d.tag_id)  // Add this line
            .call(this.drag());

        node.append("circle")
            .attr("r", d => this.getNodeSize(d))
            .attr("fill", d => this.getNodeColor(d));

        node.append("text")
            .text(d => d.name)
            .attr("text-anchor", "middle")
            .attr("dy", d => -this.getNodeSize(d) - 5)
            .style("pointer-events", "none");

        this.simulation.nodes(visibleNodes).on("tick", () => {
            link
                .attr("x1", d => d.source.x!)
                .attr("y1", d => d.source.y!)
                .attr("x2", d => d.target.x!)
                .attr("y2", d => d.target.y!);

            node
                .attr("transform", d => `translate(${d.x},${d.y})`);
        });

        this.simulation.force<d3.ForceLink<Tag, Link>>("link")!.links(visibleLinks);
        this.simulation.alpha(1).restart();
    }

    getNodeSize(node: Tag): number {
        const generation = Math.min(node.generation || 0, TagGraph.NODE_SIZES.length - 1);
        return TagGraph.NODE_SIZES[generation];
    }

    updateInfoText(draggedNode: Tag, targetNode: Tag | null): void {
        if (targetNode && targetNode !== draggedNode) {
            const existingRelationship = this.links.find(l =>
                (l.source === draggedNode && l.target === targetNode) ||
                (l.source === targetNode && l.target === draggedNode)
            );
            if (existingRelationship) {
                toastManager.showToast(`Release to remove relationship`, {
                    details: `"${targetNode.name}" and "${draggedNode.name}"`,
                    duration: 1000
                });
                // this.infoText.text(`Release to remove relationship between "${targetNode.name}" and "${draggedNode.name}"`);
            } else {
                toastManager.showToast(`Release to create relationship`, {
                    details: `"${targetNode.name}" → "${draggedNode.name}"`,
                    duration: 1000
                });
                // this.infoText.text(`Release to create relationship: "${targetNode.name}" → "${draggedNode.name}"`);
            }
        } else {
            // this.infoText.text("");
        }
    }

    async handleDragEnd(event: d3.D3DragEvent<SVGGElement, Tag, Tag>, draggedNode: Tag): Promise<void> {
        const targetNode = this.getNodeAtPosition(event.x, event.y, draggedNode);
        if (targetNode && targetNode !== draggedNode) {
            const existingRelationship = this.links.find(l =>
                (l.source === draggedNode && l.target === targetNode) ||
                (l.source === targetNode && l.target === draggedNode)
            );
            if (existingRelationship) {
                await this.removeRelationship(existingRelationship);
            } else {
                await this.createRelationship(targetNode, draggedNode);
            }
        } else {
            // If you dragged till wiggle, and didnt merge, we open the menu
            this.lastSelectedNode = draggedNode;
            this.updateNodeMenu();
        }
        this.draggedNode = null;
    }

    getNodeAtPosition(x: number, y: number, excludeNode: Tag | null = null): Tag | null {
        const radius = 20;
        return this.nodes.find(node =>
            node !== excludeNode &&
            node.visible == true &&
            Math.sqrt(Math.pow(node.x! - x, 2) + Math.pow(node.y! - y, 2)) < radius
        ) || null;
    }

    async createRelationship(parentNode: Tag, childNode: Tag): Promise<void> {
        const selectedNodesBefore = new Set(this.selectedNodes);

        const response = await fetch(fetchpath + '/update_tag_relationships', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: parentNode.tag_id, child_id: childNode.tag_id })
        });

        if (response.ok) {
            this.links.push({ source: parentNode, target: childNode });
            parentNode.children.push(childNode);

            // Reset pointer counts
            this.nodes.forEach(node => {
                this.pointerCounts.set(node.tag_id, this.isOrphan(node) ? 1 : 0);
            });

            // Re-enable all previously selected nodes
            selectedNodesBefore.forEach(node => {
                this.updatePointerCounts(node, 1);
            });

            this.updateGraph();
        } else {
            console.error('Failed to create relationship');
        }
    }

    async removeRelationship(relationship: Link): Promise<void> {
        const selectedNodesBefore = new Set(this.selectedNodes);

        const response = await fetch(fetchpath + '/remove_tag_relationship', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ parent_id: relationship.source.tag_id, child_id: relationship.target.tag_id })
        });

        if (response.ok) {
            this.links = this.links.filter(l => l !== relationship);
            relationship.source.children = relationship.source.children.filter(c => c !== relationship.target);

            // Reset pointer counts
            this.nodes.forEach(node => {
                this.pointerCounts.set(node.tag_id, this.isOrphan(node) ? 1 : 0);
            });

            // Re-enable all previously selected nodes
            selectedNodesBefore.forEach(node => {
                this.updatePointerCounts(node, 1);
            });

            this.updateGraph();
        } else {
            console.error('Failed to remove relationship');
        }
    }


    hideDescendants(node: Tag): void {
        node.children.forEach(child => {
            if (!this.selectedNodes.has(child)) {
                child.visible = false;
                // this.hideDescendants(child);
            }
        });
    }

    updateSelectedTagsLists(): void {
        const selectedTags = Array.from(this.selectedNodes).map(n => n.name);
        const uniqueSelectedTags = [...new Set(selectedTags)].join(", ");
        document.getElementById("selectedNoteTags")!.textContent = uniqueSelectedTags;
        // document.getElementById("selectedSearchTags")!.textContent = uniqueSelectedTags;
    }

    performSearch() {
        toggleLoadingAnimation(true);
        const searchText = (document.getElementById("searchText") as HTMLInputElement).value;
        const password = (document.getElementById("searchPassword") as HTMLInputElement).value;
        const tags = Array.from(this.selectedNodes).map(n => n.tag_id);

        fetch(fetchpath + '/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: searchText, tags, password })
        })
            .then(response => {
                if (!response.ok) {
                    return response.text().then(text => {
                        throw new Error(`HTTP error! status: ${response.status}, body: ${text}`);
                    });
                }
                return response.json();
            })
            .then(results => displaySearchResults(results))
            .catch(error => {
                console.error('Failed to search notes:', error);
                toastManager.showToast('Search failed', { isError: true, details: error.message, duration: 5000 });
                toggleLoadingAnimation(false);
            });
    }
    initialize(): void {
        this.svg.append("defs").append("marker")
            .attr("id", "arrowhead")
            .attr("viewBox", "0 -5 10 10")
            .attr("refX", 20)
            .attr("refY", 0)
            .attr("markerWidth", 6)
            .attr("markerHeight", 6)
            .attr("orient", "auto")
            .append("path")
            .attr("d", "M0,-5L10,0L0,5")
            .attr("fill", TagGraph.COLORS.ARROW);

        const style = document.createElement('style');
        style.textContent = `
                .node circle {
                    rx: 5;
                    ry: 5;
                }
            `;
        document.head.appendChild(style);
        this.loadData().then(() => {
            console.log("Nodes:", this.nodes);
            console.log("Links:", this.links);
            console.log("Pointer Counts:", this.pointerCounts);
        });

        this.svg.on("click", (event: MouseEvent) => {
            if (!this.isDragging && (event.target as Element).tagName === "circle") {
                const node = d3.select((event.target as Element).parentNode as Element).datum() as Tag;
                this.toggleNodeSelection(node);
            }
        });
    }
}



function generateReadableId(name: string): string {
    let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let id = base;
    let counter = 1;
    while (document.querySelector(`[data-readable-id="${id}"]`)) {
        id = `${base}-${counter}`;
        counter++;
    }
    return id;
}

async function addTag(): Promise<void> {
    const nameInput = document.getElementById("tagName") as HTMLInputElement;
    const name = nameInput.value.trim();
    if (!name) return;

    const readable_id = generateReadableId(name);

    const response = await fetch(fetchpath + '/add_tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, readable_id })
    });

    if (response.ok) {
        nameInput.value = "";
        (window as any).tagGraph.loadData();
    } else {
        console.error('Failed to add tag');
    }
}

async function searchNotes(): Promise<void> {
    toggleLoadingAnimation(true);
    const searchText = (document.getElementById("searchText") as HTMLInputElement).value;
    const password = (document.getElementById("searchPassword") as HTMLInputElement).value;
    const tags = Array.from((window as any).tagGraph.selectedNodes as Set<Tag>).map((n: Tag) => n.tag_id);
    const sortCriteria = (document.getElementById("sortCriteria") as HTMLInputElement).value;

    const response = await fetch(fetchpath + '/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: searchText, tags, password, sortCriteria })
    });

    if (response.ok) {
        const results = await response.json();
        displaySearchResults(results);
        toggleLoadingAnimation(false);
    } else {
        console.error('Failed to search notes');
    }
}

function initializeSettingsMenu(): void {
    const updateGlobalPasswordsBtn = document.getElementById('updateGlobalPasswords');
    const generateTagPasswordBtn = document.getElementById('generateTagPassword');

    if (updateGlobalPasswordsBtn) {
        updateGlobalPasswordsBtn.addEventListener('click', updateGlobalPasswords);
    }

    if (generateTagPasswordBtn) {
        generateTagPasswordBtn.addEventListener('click', handleGenerateTagPassword);
    }
}

async function updateGlobalPasswords(): Promise<void> {
    const vis1Password = prompt("Enter new password for visibility 1:");
    const vis3Password = prompt("Enter new password for visibility 3:");
    const vis5Password = prompt("Enter new password for visibility 5:");

    if (!vis1Password || !vis3Password || !vis5Password) {
        alert("All passwords must be provided.");
        return;
    }

    try {
        const response = await fetch(fetchpath + '/update_global_passwords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ vis1: vis1Password, vis3: vis3Password, vis5: vis5Password })
        });

        const result = await response.json();
        if (result.success) {
            alert("Global passwords updated successfully.");
        } else {
            alert("Failed to update global passwords: " + result.error);
        }
    } catch (error) {
        console.error('Error updating global passwords:', error);
        alert("An error occurred while updating global passwords.");
    }
}
async function handleGenerateTagPassword(): Promise<void> {
    const tagName = prompt("Enter the name of the tag for which you want to generate a password:");
    if (!tagName) return;

    const tag = (window as any).tagGraph.nodes.find((n: Tag) => n.name === tagName);
    if (!tag) {
        alert("Tag not found.");
        return;
    }

    const maxVisibility = parseInt(prompt("Enter the maximum visibility level for this password (1-5):", "3") || "3", 10);
    if (maxVisibility < 1 || maxVisibility > 5) {
        alert("Invalid visibility level. Please enter a number between 1 and 5.");
        return;
    }

    const adminPassword = prompt("Enter the administrator password (visibility 5 password):");
    if (!adminPassword) {
        alert("Administrator password is required.");
        return;
    }

    try {
        const response = await fetch(fetchpath + '/generate_tag_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tag_id: tag.tag_id,
                max_visibility: maxVisibility,
                admin_password: adminPassword
            })
        });

        const result = await response.json();
        if (result.success) {
            alert(`Generated password for tag "${tagName}" (max visibility ${maxVisibility}): ${result.password}`);
        } else {
            alert(`Failed to generate password: ${result.error}`);
        }
    } catch (error) {
        console.error('Error generating tag password:', error);
        alert("An error occurred while generating the password. Please check the console for more details.");
    }
}


interface SearchResult {
    mmr: number;
    text: string;
    author: string;
    date: number; // unix timestamp
    rating: number;
    source: string;
    visibility: number;
    tags: string;
    note_id: number;
}

interface OriginalNoteData extends SearchResult { }

function toggleLoadingAnimation(isSerarching: boolean) {
    const loadingIndicator = document.getElementById("loadingIndicator");
    if (loadingIndicator) loadingIndicator.style.display = isSerarching ? 'block' : 'none';

}


function enableInPlaceEditing(textContainer: HTMLElement, note: SearchResult): void {
    if (textContainer.querySelector('textarea')) return;

    const originalContent = textContainer.innerHTML;
    const originalText = note.text;
    const editContainer = document.createElement('div');
    editContainer.className = 'edit-container';

    const textarea = document.createElement('textarea');
    textarea.value = originalText;
    textarea.style.width = '100%';
    textarea.style.minHeight = `${textContainer.offsetHeight}px`;
    textarea.style.fontFamily = 'inherit';
    textarea.style.fontSize = 'inherit';
    textarea.style.resize = 'none';
    textarea.style.border = '1px solid #ccc';
    textarea.style.padding = '2px';
    textarea.style.boxSizing = 'border-box';
    textarea.style.overflow = 'hidden';

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'edit-button-container';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';
    saveButton.className = 'edit-save-button';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';
    cancelButton.className = 'edit-cancel-button';

    buttonContainer.appendChild(saveButton);
    buttonContainer.appendChild(cancelButton);

    editContainer.appendChild(textarea);
    editContainer.appendChild(buttonContainer);

    textContainer.innerHTML = '';
    textContainer.appendChild(editContainer);

    function adjustHeight() {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    adjustHeight();
    textarea.addEventListener('input', adjustHeight);

    textarea.setSelectionRange(0, 0);

    requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(0, 0);
    });

    let isEditingComplete = false;

    toastManager.showToast('Edit mode: <b>Esc</b> to cancel, <b>Ctrl+Enter</b> to save', { duration: 3000 });

    async function saveChanges() {
        if (isEditingComplete) return;
        isEditingComplete = true;

        const newText = textarea.value;
        if (newText !== originalText) {
            try {
                const updatedNote = await saveEditedNoteText(note.note_id, newText, note);
                note.text = updatedNote.text;
                updateNoteDisplay(textContainer, updatedNote.text);
                toastManager.showToast('Changes saved successfully', { duration: 2000 });
            } catch (error) {
                console.error('Failed to save note:', error);
                updateNoteDisplay(textContainer, originalText);
                toastManager.showToast('Failed to save changes', { isError: true, duration: 3000 });
            }
        } else {
            updateNoteDisplay(textContainer, originalText);
        }
    }

    function revertChanges() {
        if (isEditingComplete) return;
        isEditingComplete = true;
        updateNoteDisplay(textContainer, originalText);
        toastManager.showToast('Changes reverted', { duration: 2000 });
    }

    function updateNoteDisplay(container: HTMLElement, text: string) {
        if (container.parentNode) {
            requestAnimationFrame(() => {
                container.innerHTML = parseMarkdown(text);
            });
        }
    }

    saveButton.addEventListener('click', saveChanges);
    cancelButton.addEventListener('click', revertChanges);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            revertChanges();
        } else if ((e.key === 'Enter' && e.ctrlKey) || (e.key === 'Enter' && e.metaKey)) {
            e.preventDefault();
            saveChanges();
        }
    });
}

function enableInPlaceEditing2(textContainer: HTMLElement, note: SearchResult): void {
    if (textContainer.querySelector('textarea')) return;

    const originalContent = textContainer.innerHTML;
    const originalText = note.text;
    const textarea = document.createElement('textarea');
    textarea.value = originalText;
    textarea.style.width = '100%';
    textarea.style.minHeight = `${textContainer.offsetHeight}px`;
    textarea.style.fontFamily = 'inherit';
    textarea.style.fontSize = 'inherit';
    textarea.style.resize = 'none';
    textarea.style.border = '1px solid #ccc';
    textarea.style.padding = '2px';
    textarea.style.boxSizing = 'border-box';
    textarea.style.overflow = 'hidden';

    // toastManager.showToast('Edit mode: <b>Esc</b> to revert, <b>Ctrl+Enter</b> to save', { duration: 3000 });
    toastManager.showToast('Edit mode: <b>Esc</b> to revert, <b>Ctrl+Enter</b> to save<br>On mobile: <b>Swipe up</b> to save, <b>Swipe down</b> to revert', { duration: 5000 });

    function adjustHeight() {
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }

    textContainer.innerHTML = '';
    textContainer.appendChild(textarea);

    adjustHeight();
    textarea.addEventListener('input', adjustHeight);

    textarea.setSelectionRange(0, 0);

    requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(0, 0);
    });

    let isEditingComplete = false;

    async function saveChanges() {
        if (isEditingComplete) return;
        isEditingComplete = true;

        const newText = textarea.value;
        if (newText !== originalText) {
            try {
                const updatedNote = await saveEditedNoteText(note.note_id, newText, note);
                note.text = updatedNote.text;
                updateNoteDisplay(textContainer, updatedNote.text);
            } catch (error) {
                console.error('Failed to save note:', error);
                updateNoteDisplay(textContainer, originalText);
            }
        } else {
            updateNoteDisplay(textContainer, originalText);
        }
    }

    function revertChanges() {
        if (isEditingComplete) return;
        isEditingComplete = true;
        updateNoteDisplay(textContainer, originalText);
    }

    function updateNoteDisplay(container: HTMLElement, text: string) {
        if (container.parentNode) {
            requestAnimationFrame(() => {
                container.innerHTML = parseMarkdown(text);
            });
        }
    }

    textarea.addEventListener('blur', saveChanges);

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            revertChanges();
        } else if ((e.key === 'Enter' && e.ctrlKey) || (e.key === 'Enter' && e.metaKey)) {
            e.preventDefault();
            saveChanges();
        }
    });



}
async function saveEditedNoteText(noteId: number, newText: string, originalNote: SearchResult): Promise<SearchResult> {
    try {
        const response = await fetch(fetchpath + '/edit_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                noteId,
                text: newText
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save note');
        }

        const result = await response.json();
        if (!result.success) {
            throw new Error(result.error || 'Failed to save note');
        }

        return { ...originalNote, text: newText };
    } catch (error) {
        console.error('Error saving note:', error);
        throw error;
    }
}




function displaySearchResults(results: SearchResult[]): void {
    const resultsContainer = document.getElementById("results")!;
    resultsContainer.innerHTML = "";

    // Sort the results based on the selected criteria
    const [criteria, order] = (document.getElementById("sortCriteria") as HTMLSelectElement).value.split('-');
    results.sort((a, b) => {
        let comparison = 0;
        switch (criteria) {
            case 'stars':
                comparison = a.rating - b.rating;
                break;
            case 'date':
                comparison = a.date - b.date;
                break;
            case 'visibility':
                comparison = a.visibility - b.visibility;
                break;
            case 'mmr':
                comparison = a.mmr - b.mmr;
                break;
        }
        return order === 'desc' ? -comparison : comparison;
    });

    const notesContainer = document.createElement("div");
    notesContainer.className = "notes-container";

    results.forEach(note => {
        const noteElement = document.createElement("div");
        noteElement.className = "note";

        const textContainer = document.createElement("div");
        textContainer.className = "note-text";
        textContainer.innerHTML = parseMarkdown(note.text); // Use innerHTML with parsed Markdown

        let longPressTimer: number | null = null;
        let isLongPress = false;

        textContainer.addEventListener('mousedown', (e) => {
            isLongPress = false;
            longPressTimer = window.setTimeout(() => {
                isLongPress = true;
                enableInPlaceEditing(textContainer, note);
            }, 500);
        });

        textContainer.addEventListener('mouseup', (e) => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
            }
        });

        textContainer.addEventListener('click', (e) => {
            if (isLongPress) {
                e.preventDefault(); // Prevent normal click behavior
            }
        });

        // Touch events for mobile
        textContainer.addEventListener('touchstart', (e) => {
            isLongPress = false;
            longPressTimer = window.setTimeout(() => {
                isLongPress = true;
                enableInPlaceEditing(textContainer, note);
            }, 500);
        });

        textContainer.addEventListener('touchend', (e) => {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
            }
            if (isLongPress) {
                e.preventDefault(); // Prevent normal touch behavior
            }
        });

        const metaContainer = document.createElement("div");
        metaContainer.className = "note-meta";

        const ratingAndControlsElement = document.createElement("div");
        ratingAndControlsElement.className = "note-rating-controls";

        const ratingElement = document.createElement("span");
        ratingElement.className = "note-rating";
        ratingElement.textContent = `${note.rating}⭐`;

        const visibilityIcon = document.createElement("span");
        visibilityIcon.className = "note-visibility";
        visibilityIcon.textContent = getVisibilityEmoji(note.visibility);

        const mmrElement = document.createElement("span");
        mmrElement.className = "note-mmr";
        mmrElement.textContent = `(${note.mmr})`;

        const editButton = document.createElement("button");
        editButton.className = "edit-note-btn";
        editButton.innerHTML = "✏️"; // Pencil emoji
        editButton.onclick = () => openEditNoteModal(note);

        ratingAndControlsElement.appendChild(ratingElement);
        ratingAndControlsElement.appendChild(visibilityIcon);
        ratingAndControlsElement.appendChild(mmrElement);
        ratingAndControlsElement.appendChild(editButton);

        const tagsElement = document.createElement("div");
        tagsElement.className = "note-tags";
        const wrappedTags = wrapTags(note.tags);
        tagsElement.innerHTML = `${wrappedTags.join('<br>')}`;

        metaContainer.appendChild(ratingAndControlsElement);
        metaContainer.appendChild(tagsElement);

        noteElement.appendChild(textContainer);
        noteElement.appendChild(metaContainer);

        notesContainer.appendChild(noteElement);
    });

    resultsContainer.appendChild(notesContainer);

    toggleLoadingAnimation(false);
}

function getVisibilityEmoji(visibility: number): string {
    switch (visibility) {
        case 1: return "🔓";
        case 2: return "🔒";
        case 3: return "🔐";
        case 4: return "🔏";
        default: return "🔓";
    }
}


function isTallMode(): boolean {
    return window.innerHeight > window.innerWidth;
}

async function generateTagPassword(tagId: number, maxVisibility: number = 3): Promise<string | null> {
    try {
        const response = await fetch(fetchpath + '/generate_tag_password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_id: tagId, max_visibility: maxVisibility })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                return result.password;
            }
        }
        return null;
    } catch (error) {
        console.error('Error generating tag password:', error);
        return null;
    }
}

function wrapTags(tags: string, maxLineLength: number = 30): string[] {
    if (isTallMode()) maxLineLength = 1;

    const tagArray = tags.split(',');
    let lines: string[] = [];
    let currentLine = '';

    tagArray.forEach(tag => {
        tag = tag.trim();

        if (currentLine.length === 0) {
            currentLine = tag;
        } else if (currentLine.length + tag.length + 2 <= maxLineLength) {
            currentLine += ', ' + tag;
        } else {
            lines.push(currentLine);
            currentLine = tag;
        }
    });

    if (currentLine.length > 0) {
        lines.push(currentLine);
    }

    return lines;
}

function parseMarkdown(text: string): string {
    if (typeof marked !== 'undefined') {
        // Use marked.parse directly without setOptions
        // marked.Parser.parse()
        return marked.marked.parse(text, {
            breaks: true,
            gfm: true,
            sanitize: false // Set to false to allow HTML in markdown
        });
    } else {
        console.warn('Marked library not loaded. Falling back to basic parsing.');
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\n/g, '<br>');
    }
}



// Add these functions at the end of the file

// Modify the openEditNoteModal function
function openEditNoteModal(note: SearchResult): void {
    const modal = document.getElementById('editNoteModal') as HTMLElement;
    const closeBtn = modal.querySelector('.close') as HTMLElement;
    const saveBtn = document.getElementById('saveEditNoteBtn') as HTMLElement;
    const revertBtn = document.getElementById('revertEditNoteBtn') as HTMLElement;
    const deleteBtn = document.getElementById('deleteNoteBtn') as HTMLElement;

    // Store the original note data
    const originalNoteData: OriginalNoteData = { ...note };

    function populateForm(data: SearchResult) {
        (document.getElementById('editNoteText') as HTMLTextAreaElement).value = data.text;
        (document.getElementById('editNoteAuthor') as HTMLInputElement).value = data.author;
        (document.getElementById('editNoteSource') as HTMLInputElement).value = data.source;

        // Set rating
        const ratingStars = document.querySelectorAll("#editNoteRating .star");
        ratingStars.forEach((star, index) => {
            (star as HTMLElement).classList.toggle('active', index < data.rating);
        });

        // Set visibility
        const visibilityIcons = document.querySelectorAll("#editNoteVisibility .visibility");
        visibilityIcons.forEach((vis, index) => {
            (vis as HTMLElement).classList.toggle('active', index < data.visibility);
        });

        // Set tags
        const editNoteTags = document.getElementById('editNoteTags') as HTMLElement;
        editNoteTags.innerHTML = ''; // Clear existing tags

        // Create a new div for tag text display
        const tagTextDiv = document.createElement('div');
        tagTextDiv.id = 'editNoteTagText';
        editNoteTags.appendChild(tagTextDiv);

        // Create a new div for tag selection
        const tagSelectionDiv = document.createElement('div');
        tagSelectionDiv.id = 'editNoteTagSelection';
        editNoteTags.appendChild(tagSelectionDiv);

        // Function to update tag text
        function updateTagText() {
            const selectedTags = Array.from(document.querySelectorAll('#editNoteTagSelection input:checked'))
                .map(checkbox => (checkbox as HTMLInputElement).nextSibling?.textContent || '')
                .filter(Boolean);
            tagTextDiv.textContent = `Tags: ${selectedTags.join(', ')}`;
        }

        // Add all available tags as checkboxes
        (window as any).tagGraph.nodes.forEach((tag: Tag) => {
            const tagLabel = document.createElement('label');
            const tagCheckbox = document.createElement('input');
            tagCheckbox.type = 'checkbox';
            tagCheckbox.value = tag.tag_id.toString();
            tagCheckbox.checked = data.tags.includes(tag.name);
            tagCheckbox.addEventListener('change', updateTagText);
            tagLabel.appendChild(tagCheckbox);
            tagLabel.appendChild(document.createTextNode(tag.name));
            tagSelectionDiv.appendChild(tagLabel);
        });

        // Initial update of tag text
        updateTagText();

        // Add event listeners for rating stars
        ratingStars.forEach((star) => {
            star.addEventListener('click', (event) => {
                const clickedStar = event.currentTarget as HTMLElement;
                const value = parseInt(clickedStar.getAttribute('data-value') || '1', 10);
                ratingStars.forEach((s, i) => {
                    (s as HTMLElement).classList.toggle('active', i < value);
                });
            });
        });

        // Add event listeners for visibility icons
        visibilityIcons.forEach((icon) => {
            icon.addEventListener('click', (event) => {
                const clickedIcon = event.currentTarget as HTMLElement;
                const value = parseInt(clickedIcon.getAttribute('data-value') || '1', 10);
                visibilityIcons.forEach((i, index) => {
                    (i as HTMLElement).classList.toggle('active', index < value);
                });
            });
        });
    }

    populateForm(note);

    modal.style.display = "block";

    closeBtn.onclick = () => {
        modal.style.display = "none";
    };

    saveBtn.onclick = () => {
        saveEditedNote(note.note_id);
    };

    revertBtn.onclick = () => {
        populateForm(originalNoteData);
    };

    deleteBtn.onclick = () => {
        if (confirm("Are you sure you want to delete this note? This action cannot be undone.")) {
            deleteNote(note.note_id);
        }
    };

    window.onclick = (event) => {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    };
}

async function deleteNote(noteId: number): Promise<void> {
    try {
        const response = await fetch(fetchpath + '/delete_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                alert('Note deleted successfully!');
                (document.getElementById('editNoteModal') as HTMLElement).style.display = "none";
                // Refresh the search results
                searchNotes();
            } else {
                alert('Failed to delete note: ' + result.error);
            }
        } else {
            const errorData = await response.json();
            alert('Failed to delete note: ' + errorData.error);
        }
    } catch (error) {
        console.error('Error deleting note:', error);
        alert('Error deleting note: ' + error);
    }
}



async function saveEditedNote(noteId: number): Promise<void> {
    const text = (document.getElementById("editNoteText") as HTMLTextAreaElement).value;
    const author = (document.getElementById("editNoteAuthor") as HTMLInputElement).value;
    const source = (document.getElementById("editNoteSource") as HTMLInputElement).value;
    const rating = document.querySelectorAll("#editNoteRating .star.active").length;
    const visibility = document.querySelectorAll("#editNoteVisibility .visibility.active").length;

    // Get selected tags with correct type assertion
    const selectedTags = Array.from(document.querySelectorAll('#editNoteTagSelection input[type="checkbox"]:checked'))
        .map((checkbox) => parseInt((checkbox as HTMLInputElement).value, 10));

    try {
        const response = await fetch(fetchpath + '/edit_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId, text, author, rating, source, visibility, tags: selectedTags })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                alert('Note updated successfully!');
                (document.getElementById('editNoteModal') as HTMLElement).style.display = "none";
                // Refresh the search results
                searchNotes();
            } else {
                alert('Failed to update note: ' + result.error);
            }
        } else {
            const errorData = await response.json();
            alert('Failed to update note: ' + errorData.error);
        }
    } catch (error) {
        console.error('Error updating note:', error);
        alert('Error updating note: ' + error);
    }
}

function initRating(containerId: string): void {
    const container = document.getElementById(containerId);
    if (!container) return;

    const items = container.getElementsByClassName(containerId === 'noteRating' ? 'star' : 'visibility');

    container.addEventListener('click', (e: Event) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('star') || target.classList.contains('visibility')) {
            const value = target.getAttribute('data-value') ?? '';
            Array.from(items).forEach((item: Element) => {
                if (item instanceof HTMLElement) {
                    const itemValue = item.getAttribute('data-value') ?? '';
                    item.classList.toggle('active', itemValue <= value);
                }
            });
        }
    });
}

// Initialize star ratings
initRating('noteRating');
initRating('noteVisibility');


// Function to update preview
function updatePreview(): void {
    const noteText = (document.getElementById('noteText') as HTMLTextAreaElement).value;
    const notePreview = document.getElementById('notePreview');
    if (notePreview) {
        notePreview.innerHTML = parseMarkdown(noteText);
    }
}

// Add event listener to noteText
const noteTextArea = document.getElementById('noteText');
if (noteTextArea) {
    noteTextArea.addEventListener('input', updatePreview);
}

function saveFormData(): void {
    const text = (document.getElementById("noteText") as HTMLTextAreaElement).value;
    const author = (document.getElementById("noteAuthor") as HTMLInputElement).value;
    const source = (document.getElementById("noteSource") as HTMLInputElement).value;
    const rating = document.querySelectorAll("#noteRating .star.active").length;
    const visibility = document.querySelectorAll("#noteVisibility .visibility.active").length;


    // Get selected tags
    const selectedTags = Array.from((window as any).tagGraph.selectedNodes as Set<Tag>)
        .map((tag: Tag) => tag.tag_id);

    localStorage.setItem('noteFormData', JSON.stringify({
        text, author, source, rating, visibility, selectedTags
    }));
}

// Function to load form data from localStorage
function loadFormData(): void {
    const savedData = localStorage.getItem('noteFormData');
    if (savedData) {
        const { text, author, source, rating, visibility, selectedTags } = JSON.parse(savedData);

        (document.getElementById("noteText") as HTMLTextAreaElement).value = text;
        (document.getElementById("noteAuthor") as HTMLInputElement).value = author;
        (document.getElementById("noteSource") as HTMLInputElement).value = source;

        // Set rating
        document.querySelectorAll("#noteRating .star").forEach((star, index) => {
            star.classList.toggle('active', index < rating);
        });

        // Set visibility
        document.querySelectorAll("#noteVisibility .visibility").forEach((vis, index) => {
            vis.classList.toggle('active', index < visibility);
        });

        // Restore selected tags
        if (selectedTags && Array.isArray(selectedTags)) {
            // Clear existing selections
            (window as any).tagGraph.selectedNodes.clear();
            (window as any).tagGraph.updateGraph();

            // Find and simulate click on each saved tag
            selectedTags.forEach((tagId: number) => {
                const tagElement = document.querySelector(`.node[data-tag-id="${tagId}"] circle`) as SVGCircleElement | null;
                if (tagElement) {
                    tagElement.dispatchEvent(new MouseEvent('click', {
                        view: window,
                        bubbles: true,
                        cancelable: true
                    }));
                }
            });
        }

        // Update preview
        updatePreview();
    }
}

// Function to clear form data
function clearFormData(): void {
    (document.getElementById("noteText") as HTMLTextAreaElement).value = "";
    localStorage.removeItem('noteFormData');
    updatePreview();
}

// Add event listeners to form fields
document.getElementById("noteText")?.addEventListener('input', saveFormData);
document.getElementById("noteAuthor")?.addEventListener('input', saveFormData);
document.getElementById("noteSource")?.addEventListener('input', saveFormData);
document.getElementById("noteRating")?.addEventListener('click', saveFormData);
document.getElementById("noteVisibility")?.addEventListener('click', saveFormData);

// Load saved form data when the page loads
window.addEventListener('load', loadFormData);
window.addEventListener('beforeunload', saveFormData);

async function addNote(): Promise<void> {
    const text = (document.getElementById("noteText") as HTMLTextAreaElement).value;
    const author = (document.getElementById("noteAuthor") as HTMLInputElement).value;
    const ratingElements = document.querySelectorAll("#noteRating .star.active");
    const rating = ratingElements.length; // This will give us the correct rating based on the number of active stars
    const source = (document.getElementById("noteSource") as HTMLInputElement).value;
    const visibilityElement = document.querySelector("#noteVisibility .visibility.active:last-of-type");
    const visibility = visibilityElement ? parseInt(visibilityElement.getAttribute('data-value') || '1', 10) : 1;
    const tags = Array.from((window as any).tagGraph.selectedNodes as Set<Tag>).map((n: Tag) => n.tag_id);

    // Validation checks
    if (text.trim() === '') {
        alert('Please enter some text for the note.');
        return;
    }

    if (tags.length === 0) {
        alert('Please select at least one tag for the note.');
        return;
    }

    if (rating === 0) {
        alert('Please select a rating for the note.');
        return;
    }

    console.log("Sending note data:", { text, author, rating, source, visibility, tags });

    try {
        const response = await fetch(fetchpath + '/add_note', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, author, rating, source, visibility, tags })
        });

        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                clearFormData(); // Clear only the text and localStorage
                // (window as any).tagGraph.selectedNodes.clear();
                // (window as any).tagGraph.updateGraph();
                // (window as any).tagGraph.updateSelectedTagsLists();
                console.log("Note added successfully");
                toastManager.showToast('Note added successfully!', { duration: 3000 });
                // alert('Note added successfully!');
            } else {
                console.error('Failed to add note:', result.error);
                // alert('Failed to add note: ' + result.error);
                toastManager.showToast('Failed to add note', { isError: true, details: result.error, duration: 5000 });
            }
        } else {
            const errorData = await response.json();
            console.error('Failed to add note:', errorData.error);
            toastManager.showToast('Failed to add note', { isError: true, details: errorData.error, duration: 5000 });

            // alert('Failed to add note: ' + errorData.error);
        }
    } catch (error) {
        console.error('Error adding note:', error);
        toastManager.showToast('Error adding note', { isError: true, details: String(error), duration: 5000 });
        // alert('Error adding note: ' + error);
    }
}


async function calculateStats(): Promise<void> {
    try {
        const response = await fetch(fetchpath + '/get_stats');
        const data = await response.json();

        document.getElementById('noteCount')!.textContent = data.note_count.toString();
        document.getElementById('tagCount')!.textContent = data.tag_count.toString();
        document.getElementById('relationshipCount')!.textContent = data.relationship_count.toString();
        document.getElementById('avgRating')!.textContent = data.avg_rating.toString();

        const visibilityDist = Object.entries(data.visibility_counts)
            .map(([level, count]) => `${getVisibilityEmoji(+level)}(${level}): ${count}`)
            .join(', ');
        document.getElementById('visibilityDistribution')!.textContent = visibilityDist;

        const topTags = data.top_tags
            .map((tag: { name: string; count: number; }) => `${tag.name} (${tag.count})`)
            .join(', ');
        document.getElementById('topTags')!.textContent = topTags;
        document.getElementById('recentNotes')!.textContent = data.recent_notes.toString();

        toastManager.showToast('Stats calculated successfully!', { duration: 3000 });
    } catch (error) {
        console.error('Error fetching stats:', error);
        toastManager.showToast('Failed to calculate stats', { isError: true, details: String(error), duration: 5000 });
    }
}


/**
 * Depricated
 */
function updateStats(): void {
    fetch(fetchpath + '/get_stats')
        .then(response => response.json())
        .then(data => {
            document.getElementById('noteCount')!.textContent = data.note_count.toString();
            document.getElementById('tagCount')!.textContent = data.tag_count.toString();
            document.getElementById('relationshipCount')!.textContent = data.relationship_count.toString();
            document.getElementById('avgRating')!.textContent = data.avg_rating.toString();


            // Format visibility distribution
            const visibilityDist = Object.entries(data.visibility_counts)
                .map(([level, count]) => `${getVisibilityEmoji(+level)}(${level}): ${count}`)
                .join(', ');
            document.getElementById('visibilityDistribution')!.textContent = visibilityDist;

            const topTags = data.top_tags
                .map((tag: { name: string; count: number; }) => `${tag.name} (${tag.count})`)
                .join(', ');
            document.getElementById('topTags')!.textContent = topTags;
            document.getElementById('recentNotes')!.textContent = data.recent_notes.toString();

        })
        .catch(error => console.error('Error fetching stats:', error));
}

class ToastManager {
    private container: HTMLElement;
    private activeToasts: Map<string, { element: HTMLElement, timer: number }> = new Map();

    constructor() {
        this.container = document.getElementById('toastContainer') as HTMLElement;
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toastContainer';
            this.container.className = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    showToast(message: string, options: {
        duration?: number,
        isError?: boolean,
        details?: string
    } = {}): void {
        const { duration = 3000, isError = false, details } = options;
        const key = `${message}-${details || ''}`;

        if (this.activeToasts.has(key)) {
            const existingToast = this.activeToasts.get(key)!;
            clearTimeout(existingToast.timer);
            existingToast.timer = this.setToastTimer(existingToast.element, key, duration);
            return;
        }

        const toast = this.createToastElement(message, isError, details);
        this.container.appendChild(toast);

        // Trigger reflow to enable transition
        toast.offsetHeight;
        toast.classList.add('show');

        const timer = this.setToastTimer(toast, key, duration);
        this.activeToasts.set(key, { element: toast, timer });
    }

    private createToastElement(message: string, isError: boolean, details?: string): HTMLElement {
        const toast = document.createElement('div');
        toast.className = 'toast';

        const messageElement = document.createElement('div');
        messageElement.className = 'toast-message';
        messageElement.innerHTML = message;
        toast.appendChild(messageElement);

        if (details) {
            const detailsElement = document.createElement('div');
            detailsElement.className = 'toast-details';
            detailsElement.innerHTML = details;
            toast.appendChild(detailsElement);
        }

        if (isError) {
            toast.classList.add('error');
        }

        return toast;
    }

    private setToastTimer(toast: HTMLElement, key: string, duration: number): number {
        return window.setTimeout(() => {
            toast.classList.add('remove');
            toast.addEventListener('transitionend', () => {
                if (toast.parentNode === this.container) {
                    this.container.removeChild(toast);
                }
                this.activeToasts.delete(key);
            }, { once: true });
        }, duration);
    }
}

// Initialize the ToastManager
const toastManager = new ToastManager();

// Example usage:
toastManager.showToast('Welcome to DyNotes! :)');


let currentMMRNotes: SearchResult[] = [];
let areRatingsVisible = false;
let isComparisonInProgress = false;

class MMRComparison {
    private toast: HTMLElement;
    private notes: NodeListOf<HTMLElement>;
    private toastTimeout: number | null = null;
    private isToastVisible: boolean = false;
    private pendingComparison: boolean = false;
    private comparisonQueue: SearchResult[][] = [];
    private isLoadingComparisons: boolean = false;
    private fastModeCheckbox: HTMLInputElement;
    private optimisticUpdates: Map<number, number> = new Map();
    private isSkipping: boolean = false;

    constructor() {
        this.toast = document.getElementById('mmrToast') as HTMLElement;
        this.notes = document.querySelectorAll('.mmr-note') as NodeListOf<HTMLElement>;
        this.fastModeCheckbox = document.getElementById('fastModeCheckbox') as HTMLInputElement;

        this.initializeEventListeners();
    }
    private initializeEventListeners(): void {
        const startMMRComparisonBtn = document.getElementById('startMMRComparison');
        const mmrModal = document.getElementById('mmrModal');
        const closeMMRModal = mmrModal?.querySelector('.close');
        const toggleMMRRatingsBtn = document.getElementById('toggleMMRRatings');
        const skipMMRComparisonBtn = document.getElementById('skipMMRComparison');
        if (skipMMRComparisonBtn) {
            skipMMRComparisonBtn.addEventListener('click', () => this.showNextComparison());
        }

        startMMRComparisonBtn?.addEventListener('click', this.startComparison.bind(this));
        closeMMRModal?.addEventListener('click', () => {
            if (mmrModal) mmrModal.style.display = 'none';
        });
        toggleMMRRatingsBtn?.addEventListener('click', this.toggleRatings.bind(this));

        document.querySelectorAll('.mmr-note').forEach((noteElement, index) => {
            noteElement.addEventListener('click', () => this.updateMMR(index));
        });



        window.addEventListener('click', (event) => {
            if (event.target === mmrModal && mmrModal != null) {
                mmrModal.style.display = 'none';
            }
        });

        // Add a global click listener for managing toast visibility
        document.addEventListener('click', this.handleGlobalClick.bind(this));
    }

    private handleGlobalClick(event: MouseEvent): void {
        console.log("global click!")
        if (this.isToastVisible && !this.toast.contains(event.target as Node)) {
            this.hideToastAndContinue();
        }
    }

    async startComparison(): Promise<void> {
        if (this.comparisonQueue.length === 0) {
            await this.loadMoreComparisons();
        }
        this.showNextComparison();
    }

    private showNextComparison(): void {
        this.isSkipping = false;
        if (this.comparisonQueue.length > 0) {
            const notes = this.comparisonQueue.shift()!;
            currentMMRNotes = notes;
            this.displayNotes(notes);
            (document.getElementById('mmrModal') as HTMLElement).style.display = 'block';
        } else {
            this.loadMoreComparisons().then(() => {
                if (this.comparisonQueue.length > 0) {
                    this.showNextComparison();
                } else {
                    alert('No more comparisons available. Try selecting different tags.');
                }
            });
        }
    }

    private async loadMoreComparisons(): Promise<void> {
        if (this.isLoadingComparisons) return;
        this.isLoadingComparisons = true;
        this.isSkipping = true;

        const tags = Array.from((window as any).tagGraph.selectedNodes as Set<Tag>).map((n: Tag) => n.tag_id);
        const password = (document.getElementById("searchPassword") as HTMLInputElement).value;

        try {
            const response = await fetch(fetchpath + '/get_mmr_notes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags, password })
            });
            const notes = await response.json();
            if (notes.length === 2) {
                this.comparisonQueue.push(notes);
            } else {
                console.warn('Not enough notes found for comparison.');
            }
        } catch (error) {
            console.error('Error fetching MMR notes:', error);
        } finally {
            this.isLoadingComparisons = false;
        }
    }

    private displayNotes(notes: SearchResult[]): void {
        notes.forEach((note, index) => {
            const noteElement = document.getElementById(`mmrNote${index + 1}`);
            if (noteElement) {
                const textElement = noteElement.querySelector('.mmr-note-text');
                const metaElement = noteElement.querySelector('.mmr-note-meta');
                const tagsElement = noteElement.querySelector('.mmr-note-tags');
                const ratingElement = noteElement.querySelector('.mmr-note-rating') as HTMLElement;
                const mmrElement = noteElement.querySelector('.mmr-note-mmr');

                if (textElement) textElement.textContent = note.text;
                if (metaElement) metaElement.textContent = `Author: ${note.author}, Source: ${note.source}, Visibility: ${getVisibilityEmoji(note.visibility)}`;
                if (tagsElement) tagsElement.textContent = `Tags: ${note.tags}`;

                if (ratingElement) {
                    ratingElement.textContent = `Rating: ${'⭐'.repeat(note.rating)}`;
                    ratingElement.style.display = areRatingsVisible ? 'block' : 'none';
                }

                // Apply optimistic MMR update
                const optimisticMMR = note.mmr + (this.optimisticUpdates.get(note.note_id) || 0);
                if (mmrElement) mmrElement.textContent = `MMR: ${optimisticMMR}`;
            } else {
                console.error(`Element mmrNote${index + 1} not found`);
            }
        });
    }

    private updateMMR(winnerIndex: number): void {
        if (this.pendingComparison || this.isSkipping) return;
        this.pendingComparison = true;

        const winnerId = currentMMRNotes[winnerIndex].note_id;
        const loserId = currentMMRNotes[1 - winnerIndex].note_id;

        // Optimistic update for fast mode fastMode. This is such an ugly hack. 
        setTimeout(() => {
            if (this.fastModeCheckbox.checked) {
                // console.log("hehehehaw50!")
                this.hideToastAndContinue();
            }
        }, 50);

        fetch(fetchpath + '/update_mmr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ winner_id: winnerId, loser_id: loserId })
        })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(result => {
                if (result.success) {
                    this.handleSuccessfulUpdate(winnerIndex, result);
                } else {
                    this.handleFailedUpdate(winnerId, loserId);
                }
            })
            .catch(error => {
                console.error('Error updating MMR:', error);
                this.handleFailedUpdate(winnerId, loserId);
            })
            .finally(() => {
                this.pendingComparison = false;
                if (this.comparisonQueue.length < 7) {
                    this.loadMoreComparisons();
                }
            });
    }


    private handleSuccessfulUpdate(winnerIndex: number, result: any): void {
        const winnerId = currentMMRNotes[winnerIndex].note_id;
        const loserId = currentMMRNotes[1 - winnerIndex].note_id;

        // Remove optimistic updates
        this.optimisticUpdates.delete(winnerId);
        this.optimisticUpdates.delete(loserId);


        this.showComparisonResult(winnerIndex, result.winner_change, result.loser_change, result.winner_id, result.loser_id);

    }

    private handleFailedUpdate(winnerId: number, loserId: number): void {
        // Revert optimistic updates
        this.optimisticUpdates.delete(winnerId);
        this.optimisticUpdates.delete(loserId);

        toastManager.showToast('Failed to update MMR. Please try again.', { isError: true, duration: 3000 });
    }



    private showComparisonResult(_winnerIndex: number, winnerChange: number, loserChange: number, winnerId: number, _loserId: number): void {
        if (this.toastTimeout !== null) {
            clearTimeout(this.toastTimeout);
        }

        this.notes.forEach(note => note.classList.add('darken'));

        const toastNotes = this.toast.querySelectorAll('.mmr-toast-note');
        currentMMRNotes.forEach((note, index) => {
            const toastNote = toastNotes[index];
            const isWinner = note.note_id === winnerId;
            const change = isWinner ? winnerChange : loserChange;

            toastNote.querySelector('p')!.textContent = `Note ${index + 1} (${isWinner ? 'Winner' : 'Loser'})`;
            toastNote.querySelector('.mmr-toast-rating')!.textContent = `Rating: ${'⭐'.repeat(note.rating)}`;
            toastNote.querySelector('.mmr-toast-mmr')!.innerHTML = `
                MMR: ${note.mmr} 
                <span class="change ${change >= 0 ? 'positive' : 'negative'}">
                    (${change >= 0 ? '+' : ''}${change})
                </span>
            `;
        });

        this.toast.style.display = 'block';
        this.toast.classList.remove('fade-out');
        this.toast.classList.add('fade-in');
        this.isToastVisible = true;

        // Set a flag to indicate a pending comparison
        this.pendingComparison = true;

        this.toastTimeout = window.setTimeout(() => {
            this.hideToastAndContinue();
        }, 2000);
    }

    private hideToastAndContinue(): void {
        if (!this.isToastVisible) return;

        if (this.toastTimeout !== null) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }

        this.isToastVisible = false;
        this.toast.classList.remove('fade-in');
        this.toast.classList.add('fade-out');

        this.pendingComparison = false;
        this.showNextComparison(); // Immediately show the next comparison
        setTimeout(() => {
            this.toast.style.display = 'none';
            this.notes.forEach(note => note.classList.remove('darken'));

        }, 300);
    }

    private clearComparison(): void {
        this.toast.style.display = 'none';
        this.toast.classList.remove('fade-in', 'fade-out');
        this.notes.forEach(note => note.classList.remove('darken'));
        this.isToastVisible = false;
        if (this.toastTimeout !== null) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
    }

    private toggleRatings(): void {
        areRatingsVisible = !areRatingsVisible;
        const ratingElements = document.querySelectorAll('.mmr-note-rating') as NodeListOf<HTMLElement>;
        ratingElements.forEach(el => {
            el.style.display = areRatingsVisible ? 'block' : 'none';
        });
        (document.getElementById('toggleMMRRatings') as HTMLElement).textContent =
            areRatingsVisible ? 'Hide Ratings' : 'Show Ratings';
    }
}
function initializeFullscreenToggle(): void {
    const toggleFullscreenBtn = document.getElementById('toggleFullscreen');
    if (toggleFullscreenBtn) {
        toggleFullscreenBtn.addEventListener('click', () => {
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(err => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                if (document.exitFullscreen) {
                    document.exitFullscreen();
                }
            }
        });
    }
}

function initializeQuickNotes(): void {
    const openQuickNotesBtn = document.getElementById('openQuickNotes');
    const quickNotesModal = document.getElementById('quickNotesModal');
    const closeQuickNotesBtn = quickNotesModal?.querySelector('.close');
    const quickNotesEditor = document.getElementById('quickNotesEditor');
    const saveQuickNotesBtn = document.getElementById('saveQuickNotes');

    if (openQuickNotesBtn && quickNotesModal && closeQuickNotesBtn && quickNotesEditor && saveQuickNotesBtn) {
        openQuickNotesBtn.addEventListener('click', () => {
            quickNotesModal.style.display = 'block';
            loadQuickNotes();
        });

        closeQuickNotesBtn.addEventListener('click', () => {
            quickNotesModal.style.display = 'none';
        });

        quickNotesEditor.addEventListener('input', handleQuickNotesInput);
        quickNotesEditor.addEventListener('keydown', handleQuickNotesKeydown);

        saveQuickNotesBtn.addEventListener('click', saveQuickNotes);

        window.addEventListener('click', (event) => {
            if (event.target === quickNotesModal) {
                quickNotesModal.style.display = 'none';
            }
        });
    }
}

function loadQuickNotes(): void {
    const quickNotesEditor = document.getElementById('quickNotesEditor');
    const savedNotes = localStorage.getItem('quickNotes') || '';

    if (quickNotesEditor) {
        quickNotesEditor.innerHTML = savedNotes.split('\n').map(line =>
            `<p class="markdown-line">${parseMarkdown(line)}</p>`
        ).join('');
    }
}

function saveQuickNotes(): void {
    const quickNotesEditor = document.getElementById('quickNotesEditor');
    if (quickNotesEditor) {
        const plainText = Array.from(quickNotesEditor.children)
            .map(child => child.textContent)
            .join('\n');
        localStorage.setItem('quickNotes', plainText);
        toastManager.showToast('Quick Notes saved successfully!', { duration: 3000 });
    }
}

function handleQuickNotesInput(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.tagName === 'P') {
        const line = target.textContent || '';
        target.innerHTML = parseMarkdown(line);
    }
}

function handleQuickNotesKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
        event.preventDefault();
        const selection = window.getSelection();
        const range = selection?.getRangeAt(0);
        const newParagraph = document.createElement('p');
        newParagraph.className = 'markdown-line';
        newParagraph.textContent = '\n';
        range?.insertNode(newParagraph);
        range?.setStartAfter(newParagraph);
        range?.setEndAfter(newParagraph);
        selection?.removeAllRanges();
        selection?.addRange(range!);
    }
}

// Initialize the graph when the DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    (window as any).tagGraph = new TagGraph("tagGraph");
    (window as any).tagGraph.initialize();
    initializeQuickNotes();


    // Add event listener for the "Add Note" button
    const showAddNoteBtn = document.getElementById('showAddNoteBtn');
    const addNoteSection = document.getElementById('addNoteSection');
    initializeFullscreenToggle();
    initializeSettingsMenu();
    if (showAddNoteBtn && addNoteSection) {
        showAddNoteBtn.addEventListener('click', () => {
            addNoteSection.style.display = addNoteSection.style.display === 'none' ? 'block' : 'none';
            showAddNoteBtn.textContent = addNoteSection.style.display === 'none' ? 'Add Note ▼' : 'Hide Add Note ▲';
        });
    }

    const calculateStatsBtn = document.getElementById('calculateStats');
    if (calculateStatsBtn) {
        calculateStatsBtn.addEventListener('click', calculateStats);
    }
    // updateStats(); // this is inefficient

    const closeAddNoteBtn = document.getElementById('closeAddNoteBtn');
    if (closeAddNoteBtn) {
        closeAddNoteBtn.addEventListener('click', () => {
            const addNoteSection = document.getElementById('addNoteSection');
            const showAddNoteBtn = document.getElementById('showAddNoteBtn');
            if (addNoteSection && showAddNoteBtn) {
                addNoteSection.style.display = 'none';
                showAddNoteBtn.textContent = 'Add Note ▼';
            }
        });
    }
    // Initialize preview functionality
    const noteText = document.getElementById('noteText') as HTMLTextAreaElement;
    const notePreview = document.getElementById('notePreview');

    if (noteText && notePreview) {
        noteText.addEventListener('input', () => {
            notePreview.innerHTML = parseMarkdown(noteText.value);
        });
    }


    new MMRComparison();


});